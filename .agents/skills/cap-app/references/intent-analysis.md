### Categories

| Category                   | What gets built                                                                                   | Asset Type|
|----------------------------|---------------------------------------------------------------------------------------------------|-----------|
| **BTP Extension**          | CAP backend + React frontend, deployed on BTP                                                     |`cap-app`|

### Decision Flow

- Does the solution require custom SAP logic, integration, or BTP-hosted UI? → **BTP Extension**

### Common Solution Patterns

| Business Need                                                                                               | Likely Solution                                              | Category               |
|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|------------------------|
| Custom approval UI, integration, or Fiori app on BTP                                                        | CAP service + React frontend on BTP                          | BTP Extension          |
