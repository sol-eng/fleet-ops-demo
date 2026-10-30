# Fleet Ops: Node.js on Posit Connect

This package is a demo of Node.js content on Posit Connect. It has three apps. They work together to show fleet monitoring, service work orders, and an AI assistant. All dealers, machines, and service bulletins are fictional.

## What is in this package

| Folder | Language | What it shows |
|---|---|---|
| `apps/ops-hub` | Node.js (Express) | A live fleet dashboard, a REST API, and CSV feeds for Power BI |
| `apps/ops-mcp` | Node.js (MCP TypeScript SDK) | An MCP server with six fleet tools for AI assistants |
| `apps/ops-assistant` | Python (Shiny, chatlas) | A chat assistant that uses the MCP tools through Claude on AWS Bedrock |
| `shared` | JavaScript and CSS | Fleet data, service bulletin search, and brand assets |
| `scripts` | Bash and Python | Scripts that copy shared files and deploy the apps |

## How the apps connect

```
 Power BI / Power Automate ──REST──▶  ops-hub  ◀──SSE── browser dashboard
                                         ▲
                                         │ POST api/work-orders
                                         │
 Positron / VS Code / Claude ──MCP──▶ ops-mcp ◀──MCP── ops-assistant (chatlas)
```

- `ops-hub` stores the work orders. It sends each new work order to open dashboards through server-sent events (SSE).
- `ops-mcp` reads fleet data from the shared data module. It sends new work orders to `ops-hub`.
- `ops-assistant` gives its MCP tools to Claude. When Claude opens a work order, the order appears on the dashboard in about one second.
- Connect handles sign-in for all three apps. Each app calls the next app with the `CONNECT_API_KEY` value that Connect gives to the running process.

## The data

The file `shared/fleet.js` creates telemetry for 41 machines at 8 dealers. Each value is a function of time. Every Connect process shows the same numbers at the same moment. No database is needed.

The file `shared/bulletins.js` holds nine service bulletins and a small TF-IDF search. In a real system, this data comes from a document store, such as SharePoint or Dataverse.

Connect deploys each app folder as a separate bundle. So each Node.js app has its own copy of the shared files in its `lib` folder. The `scripts/sync-shared.sh` script makes these copies. Run it after you change anything in `shared`.

## Requirements

- Node.js 20 or later
- Python 3.10 or later, and `uv`
- AWS credentials that can call Bedrock, for the assistant
- For Posit Connect: version 2026.06 or later, on the Advanced tier, with `NodeJs.Enabled = true` set by an administrator
- `rsconnect-python` 1.29 or later

## Run the apps on your computer

1. Copy the shared files into the apps:

   ```sh
   ./scripts/sync-shared.sh
   ```

2. Start the dashboard and API on port 3101:

   ```sh
   cd apps/ops-hub && npm install && PORT=3101 node app.js
   ```

3. In a second terminal, start the MCP server on port 3102:

   ```sh
   cd apps/ops-mcp && npm install
   PORT=3102 OPS_HUB_URL=http://127.0.0.1:3101 node server.js
   ```

4. In a third terminal, start the assistant on port 3103:

   ```sh
   cd apps/ops-assistant
   uv venv && uv pip install -r requirements.txt
   OPS_MCP_URL=http://127.0.0.1:3102/mcp .venv/bin/shiny run --port 3103 app.py
   ```

   Set `BEDROCK_MODEL` to a Claude model that your AWS account can use. The default is `us.anthropic.claude-sonnet-5`.

## Deploy to Posit Connect

You can deploy the apps in either of two ways:

- With the `rsconnect` command line tool. The steps below show this way.
- With Posit Publisher, an extension for VS Code and Positron. Open each app folder and deploy it to your Connect server from the Publisher panel. Deploy in the same order as the script: `ops-hub`, then `ops-mcp`, then `ops-assistant`. Set `OPS_HUB_URL` and `OPS_MCP_URL` in the Vars panel of each app.

### Deploy with the rsconnect CLI

1. Add your Connect server to `rsconnect` one time. Replace the placeholders with your server URL and API key:

   ```sh
   uvx --from 'rsconnect-python>=1.29' rsconnect add -n myserver -s https://<connect-server> -k <api-key>
   ```

2. Deploy the three apps in order:

   ```sh
   ./scripts/deploy.sh myserver
   ```

   Use the nickname from step 1 in place of `myserver`.

The script deploys `ops-hub` first. Then it gives the `ops-hub` URL to `ops-mcp` as `OPS_HUB_URL`. Then it gives the `ops-mcp` URL to `ops-assistant` as `OPS_MCP_URL`. Each app runs as one process. `ops-hub` keeps the work orders in memory, so more than one process would split them.

## Use the API from Power BI

1. In Power BI Desktop, select **Get Data**, then **Blank Query**.
2. Open the **Advanced Editor**. Paste this query and replace the URL with your `ops-hub` URL:

   ```
   let
     Source = Csv.Document(
       Web.Contents("https://<connect-server>/fleet-ops-hub/api/export/fleet.csv",
         [Headers = [Authorization = "Key " & ConnectApiKey]]),
       [Delimiter = ",", Encoding = 65001]),
     Fleet = Table.PromoteHeaders(Source)
   in
     Fleet
   ```

3. Add a text parameter named `ConnectApiKey`. Set it to your Connect API key.

The same API works with Power Automate. Use the HTTP action with the header `Authorization: Key <api-key>`.

## Use the MCP server from a client

Open the `ops-mcp` URL in a browser to see the six tools. The page also has client examples for chatlas, ellmer, Positron, and VS Code. The MCP endpoint is the app URL plus `/mcp`. Every client must send the header `Authorization: Key <api-key>`.

## Notes for Node.js on Connect

- Connect sets the `HOST` and `PORT` environment variables. The apps listen on these values. Do not hard-code `0.0.0.0`.
- Connect serves each app under a path prefix. All browser URLs in these apps are relative, for example `api/stream`. They do not start with `/`.
- The Node.js apps use CommonJS (`require`). If you use an ESM-only framework, add a small `.cjs` entry point that calls `import()`.
- Each bundle must include `package.json` and `package-lock.json`. Connect installs the packages from the lock file.
- The MCP server uses stateless Streamable HTTP. This mode works when Connect runs more than one process.

## Limits of this demo

- All data is fictional and generated in code.
- Work orders are kept in memory. A restart of `ops-hub` clears them.
- The demo has no database, no user roles, and no audit log. A production system needs these.
