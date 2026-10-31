# Platform

The agent will be running on the SAP Business AI Platform.
The platform provides the following qualities that mitigate certain threats.

1. **Authentication of end users**: End users are authenticated by the platform before requests reach the agent. JWT validation of incoming requests is handled by the platform — the agent does not need to validate tokens itself.
2. **Access to external systems**: External systems are exposed via tools. The identity of the current user is propagated to those systems, which are responsible for authorization checks. The agent cannot reach external systems directly — all outbound tool calls are mediated by the platform.
3. **Source code management**: The source code is managed by the platform. 
4. **Isolation**: Agents run in isolated containers and cannot reach other agents, other tenants, or arbitrary internet hosts. Outbound network access is restricted to a fixed set of platform-controlled endpoints. The agent cannot extend this set.
5. **Credential protection**: Platform credentials (LLM service keys, mTLS certificates, client secrets) are never accessible to the agent. They are managed and injected by the platform and cannot be read by agent code.
6. **Credential rotation**: Credentials used to access backend services are automatically rotated by the platform. The agent does not need to handle this.
7. **Edge protection**: The platform provides DDoS protection and geo-blocking before requests reach the agent.
8. **Resource limits**: The platform enforces CPU and memory limits on the agent.
