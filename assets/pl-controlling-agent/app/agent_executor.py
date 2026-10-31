import logging

from langchain_core.messages import SystemMessage
from langchain_core.messages.utils import count_tokens_approximately

from a2a.server.agent_execution import AgentExecutor as A2AAgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    InternalError,
    Part,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import new_agent_text_message, new_task
from a2a.utils.errors import ServerError

from agent import SampleAgent
from datetime_tool import get_datetime_tool
from load_skill_resources import get_load_skill_resource_tool
from pl_aggregation_tool import get_pl_aggregation_tool
from pl_fetch_tool import _make_fetch_aggregate_tool
from mcp_providers.agw import get_mcp_tools
from prompt_injection_detector import wrap_tool

logger = logging.getLogger(__name__)


class AgentExecutor(A2AAgentExecutor):
    def __init__(self):
        self.agent = SampleAgent()
        self.skill_tools = [get_datetime_tool(), *get_load_skill_resource_tool(), get_pl_aggregation_tool()]

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Execute the agent and stream results back via A2A protocol.

        Discovers and loads MCP tools from Agent Gateway before each execution.
        The user token is read from the context var set by JWTContextMiddleware.

        Args:
            context: Request context containing user input and task info
            event_queue: Queue for publishing task status updates

        Raises:
            ServerError: On unrecoverable agent execution errors
        """
        query = context.get_user_input()
        task = context.current_task
        if not task:
            assert context.message is not None, "Cannot create task without a message"
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        # Load MCP tools — user token is read from context var set by JWTContextMiddleware
        tools = []
        try:
            tools = await get_mcp_tools()
            if not tools:
                logger.warning("No tools returned from Agent Gateway")
        except Exception as e:
            logger.error(f"Failed to load tools from Agent Gateway: {e}")

        # Build fetch_and_aggregate_pl bound to the real journal entry MCP tools.
        # Two tools are bound:
        #   1. list_a_journalentryitembasic_* — used for the pagination fallback path
        #      (filter / top / skip params, no $-prefix)
        #   2. aggregate_a_journalentryitembasic — used for the preferred $apply path
        #      (apply param, server-side aggregation)
        # Tool name matching is explicit to avoid binding to the wrong tool.
        je_list_tool = next(
            (t for t in tools if "list_a_journalentryitembasic" in t.name.lower()),
            None,
        )
        je_agg_tool = next(
            (t for t in tools if "aggregate_a_journalentryitembasic" in t.name.lower()),
            None,
        )

        if je_list_tool is not None:
            async def _je_list_caller(**kwargs):
                # arun(tool_input) — positional dict form is the correct LangChain
                # contract for StructuredTool and mcp_tool_to_langchain wrappers alike.
                # tool_input= keyword form was ambiguous and caused silent failures with
                # some MCP wrapper implementations.
                result = await je_list_tool.arun(kwargs)
                if isinstance(result, Exception):
                    raise result
                return result

            async def _je_agg_caller(**kwargs):
                if je_agg_tool is None:
                    raise RuntimeError("aggregate_a_journalentryitembasic tool not available")
                result = await je_agg_tool.arun(kwargs)
                if isinstance(result, Exception):
                    raise result
                return result

            fetch_tool = _make_fetch_aggregate_tool(
                list_tool_fn=_je_list_caller,
                agg_tool_fn=_je_agg_caller if je_agg_tool is not None else None,
            )
            tools = [*tools, *self.skill_tools, fetch_tool]
            if je_agg_tool is None:
                logger.warning("aggregate_a_journalentryitembasic not found — $apply path unavailable, using pagination only")
        else:
            logger.warning("Journal entry list MCP tool not found — fetch_and_aggregate_pl unavailable")
            tools = [*tools, *self.skill_tools]

        # Wrap all tools with prompt injection scanning for uniform protection
        tools = [wrap_tool(t) for t in tools]

        from agent import get_system_prompt
        _system_prompt = get_system_prompt()
        _msg_tokens = count_tokens_approximately([SystemMessage(content=_system_prompt)])
        _total_tokens = count_tokens_approximately([SystemMessage(content=_system_prompt)], tools=list(tools))
        logger.info(
            "Loaded %d tool(s); token estimate — prompt: %d, tools: %d, total: %d",
            len(tools), _msg_tokens, _total_tokens - _msg_tokens, _total_tokens,
        )

        updater = TaskUpdater(event_queue, task.id, task.context_id)

        try:
            async for item in self.agent.stream(query, task.context_id, tools=tools):
                is_task_complete = item["is_task_complete"]
                require_user_input = item["require_user_input"]
                content = item["content"]

                if require_user_input:
                    # Agent requests more input
                    await updater.update_status(
                        TaskState.input_required,
                        new_agent_text_message(content, task.context_id, task.id),
                        final=True,
                    )
                    break
                elif is_task_complete:
                    # Completed: add artifact and complete task
                    await updater.add_artifact(
                        [Part(root=TextPart(text=content))], name="agent_result"
                    )
                    await updater.complete()
                    break
                else:
                    # Working status update
                    await updater.update_status(
                        TaskState.working,
                        new_agent_text_message(content, task.context_id, task.id),
                    )
        except Exception as e:
            logger.exception("Agent execution error")
            raise ServerError(error=InternalError()) from e

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise ServerError(error=UnsupportedOperationError())
