"""Fleet Ops Assistant: a chatlas chat app whose tools come from the
Node.js MCP server. Both run on Posit Connect.

Environment (set in the Connect "Vars" panel):
  OPS_MCP_URL     URL of the ops-mcp content, ending in /mcp
  BEDROCK_MODEL   optional, defaults to the model used by other demos on this server
  AWS_REGION      optional, defaults to us-east-1
Connect provides CONNECT_API_KEY to the running app; we send it to the MCP server.
"""

import os
from pathlib import Path

import httpx2
from chatlas import ChatBedrockAnthropic
from shiny import App, reactive, ui

HERE = Path(__file__).parent
MCP_URL = os.environ.get("OPS_MCP_URL", "http://127.0.0.1:3102/mcp")
MODEL = os.environ.get("BEDROCK_MODEL", "us.anthropic.claude-sonnet-5")
REGION = os.environ.get("AWS_REGION", "us-east-1")

SYSTEM_PROMPT = """
You are the Fleet Ops Assistant for a heavy-equipment service team.
You answer with live data from the fleet-ops tools. Do not guess numbers.

How to work:
- Check live data with find_machines or machine_detail before you answer.
- For an alert, call search_service_bulletins with the alert code and the model,
  and cite the bulletin ID, the fix, the part number, and the labor estimate.
- Open a work order with create_work_order only when the user asks for one.
  Put the bulletin ID in the issue text. Use High priority for ENG-TEMP and HYD-PRESS.
- Keep answers short: a one-line summary, then a small markdown table or list.
- All dealers and machines are fictional demo data.
"""

GREETING = """
**Ask about the fleet in plain language.** I read live telemetry, search the
service bulletin library, and open work orders through an MCP server written in
Node.js and hosted on Posit Connect.

<span class="suggestion">Which machines are in alert right now?</span>

<span class="suggestion">Which machines are in alert, and what does the service library say to do about each one?</span>

<span class="suggestion">Open a high-priority work order for the worst alert and cite the bulletin.</span>

<span class="suggestion">How is utilization by region?</span>
"""

app_ui = ui.page_fillable(
    ui.head_content(
        ui.tags.link(rel="stylesheet", href="posit-tokens.css"),
        ui.tags.link(rel="stylesheet", href="app.css"),
    ),
    ui.tags.header(
        ui.tags.img(src="logos/posit-horiz-white.png", alt="Posit", height="28"),
        ui.tags.span(class_="divider", **{"aria-hidden": "true"}),
        ui.div(
            ui.p("CHATLAS + MCP ON POSIT CONNECT", class_="eyebrow-dark"),
            ui.h1("Fleet Ops Assistant", class_="app-title"),
        ),
        class_="topbar",
    ),
    ui.chat_ui(
        "chat",
        greeting=ui.markdown(GREETING),
        placeholder="Ask about machines, alerts, bulletins, or work orders",
        width="min(900px, 100%)",
    ),
    padding=0,
    gap=0,
    title="Fleet Ops Assistant",
)


def server(input, output, session):
    client = ChatBedrockAnthropic(model=MODEL, aws_region=REGION, system_prompt=SYSTEM_PROMPT)
    ui.Chat("chat", client=client, history=False)

    # mcp 2.x takes an HTTP client rather than headers. Long read timeout
    # because an MCP server can hold a response stream open.
    headers = {}
    if os.environ.get("CONNECT_API_KEY"):
        headers["Authorization"] = f"Key {os.environ['CONNECT_API_KEY']}"
    http_client = httpx2.AsyncClient(headers=headers, timeout=httpx2.Timeout(30, read=300))

    @reactive.effect
    async def _register_tools():
        await client.register_mcp_tools_http_stream_async(
            url=MCP_URL,
            name="fleet-ops",
            transport_kwargs={"http_client": http_client},
        )

    @session.on_ended
    async def _cleanup():
        await client.cleanup_mcp_tools()
        await http_client.aclose()


app = App(app_ui, server, static_assets=HERE / "www")
