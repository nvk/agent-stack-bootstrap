#!/usr/bin/env python3
"""Small OpenAI Responses API adapter for antirez/ds4-server."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class Config:
    host = "127.0.0.1"
    port = 4817
    ds4_base_url = "http://127.0.0.1:8000"
    model = "deepseek-v4-flash"
    max_tokens = 2048


def text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict):
            kind = part.get("type")
            if kind in {"input_text", "output_text", "text"}:
                parts.append(str(part.get("text", "")))
            elif "text" in part:
                parts.append(str(part["text"]))
    return "\n".join(p for p in parts if p)


def messages_from_responses_request(body: dict[str, Any]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    instructions = body.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        messages.append({"role": "system", "content": instructions})

    input_value = body.get("input")
    if isinstance(input_value, str):
        messages.append({"role": "user", "content": input_value})
        return messages

    if not isinstance(input_value, list):
        return messages

    for item in input_value:
        if not isinstance(item, dict):
            continue

        item_type = item.get("type")
        if item_type == "reasoning":
            continue

        if item_type == "function_call":
            name = str(item.get("name") or "")
            arguments = item.get("arguments") or "{}"
            call_id = str(item.get("call_id") or item.get("id") or f"call_{len(messages)}")
            if name:
                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {"name": name, "arguments": arguments},
                            }
                        ],
                    }
                )
            continue

        if item_type == "function_call_output":
            content = item.get("output")
            if content is None:
                content = text_from_content(item.get("content"))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": str(item.get("call_id") or item.get("id") or ""),
                    "content": str(content or ""),
                }
            )
            continue

        role = item.get("role") or "user"
        if role in {"developer", "system"}:
            role = "system"
        elif role not in {"user", "assistant", "tool"}:
            role = "user"

        text = text_from_content(item.get("content"))
        if text:
            messages.append({"role": role, "content": text})

    return messages or [{"role": "user", "content": ""}]


def tools_from_responses_request(body: dict[str, Any]) -> list[dict[str, Any]]:
    chat_tools: list[dict[str, Any]] = []
    tools = body.get("tools")
    if not isinstance(tools, list):
        return chat_tools

    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "function":
            continue
        name = tool.get("name")
        if not name:
            continue
        chat_tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description") or "",
                    "parameters": tool.get("parameters") or {},
                },
            }
        )
    return chat_tools


def tool_choice_from_responses_request(body: dict[str, Any]) -> Any:
    choice = body.get("tool_choice")
    if choice in {"auto", "none", "required"}:
        return choice
    if isinstance(choice, dict):
        name = choice.get("name")
        if choice.get("type") == "function" and name:
            return {"type": "function", "function": {"name": name}}
    return None


def call_ds4_chat(body: dict[str, Any]) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    messages = messages_from_responses_request(body)
    max_tokens = body.get("max_output_tokens") or body.get("max_tokens") or Config.max_tokens
    temperature = body.get("temperature")
    if temperature is None:
        temperature = 0

    payload = {
        "model": body.get("model") or Config.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
        "think": False,
    }
    tools = tools_from_responses_request(body)
    if tools:
        payload["tools"] = tools
        tool_choice = tool_choice_from_responses_request(body)
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{Config.ds4_base_url.rstrip('/')}/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ds4 chat request failed: HTTP {exc.code}: {detail}") from exc

    choice = (result.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    text = message.get("content") or choice.get("text") or ""
    tool_calls = message.get("tool_calls") or []
    usage = result.get("usage") or {}
    return str(text), usage, tool_calls


def response_object(
    response_id: str,
    model: str,
    text: str,
    usage: dict[str, Any],
    tool_calls: list[dict[str, Any]],
) -> dict[str, Any]:
    created_at = int(time.time())
    message_id = f"msg_{response_id[5:]}"
    input_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    output: list[dict[str, Any]] = []
    if text or not tool_calls:
        output.append(
            {
                "id": message_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": text,
                        "annotations": [],
                    }
                ],
            }
        )

    for index, call in enumerate(tool_calls):
        function = call.get("function") or {}
        output.append(
            {
                "id": f"fc_{response_id[5:]}_{index}",
                "type": "function_call",
                "status": "completed",
                "call_id": str(call.get("id") or f"call_{response_id[5:]}_{index}"),
                "name": str(function.get("name") or call.get("name") or ""),
                "arguments": str(function.get("arguments") or call.get("arguments") or "{}"),
            }
        )

    return {
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": "completed",
        "error": None,
        "incomplete_details": None,
        "instructions": None,
        "max_output_tokens": None,
        "model": model,
        "output": output,
        "parallel_tool_calls": True,
        "previous_response_id": None,
        "store": False,
        "temperature": None,
        "tool_choice": "auto",
        "tools": [],
        "top_p": None,
        "truncation": "disabled",
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ds4-responses-shim/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, code: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": Config.model})
        elif self.path in {"/v1/models", "/models"}:
            self.send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": Config.model,
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "ds4",
                        }
                    ],
                },
            )
        else:
            self.send_json(404, {"error": {"message": f"unknown path: {self.path}"}})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            self.send_json(400, {"error": {"message": f"invalid json: {exc}"}})
            return

        if self.path != "/v1/responses":
            self.send_json(404, {"error": {"message": f"unknown path: {self.path}"}})
            return

        response_id = f"resp_{int(time.time() * 1000)}"
        model = body.get("model") or Config.model

        try:
            text, usage, tool_calls = call_ds4_chat(body)
        except Exception as exc:
            self.send_json(502, {"error": {"message": str(exc)}})
            return

        response = response_object(response_id, model, text, usage, tool_calls)
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.write_events(response)
            self.close_connection = True
        else:
            self.send_json(200, response)

    def write_sse(self, event: str, payload: dict[str, Any] | str) -> None:
        self.wfile.write(f"event: {event}\n".encode("utf-8"))
        if isinstance(payload, str):
            data = payload
        else:
            data = json.dumps(payload, separators=(",", ":"))
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()

    def write_message_events(self, item: dict[str, Any], output_index: int) -> None:
        part = item["content"][0]
        item_id = item["id"]

        self.write_sse(
            "response.output_item.added",
            {
                "type": "response.output_item.added",
                "output_index": output_index,
                "item": {**item, "status": "in_progress", "content": []},
            },
        )
        self.write_sse(
            "response.content_part.added",
            {
                "type": "response.content_part.added",
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": {**part, "text": ""},
            },
        )
        text = str(part.get("text") or "")
        if text:
            self.write_sse(
                "response.output_text.delta",
                {
                    "type": "response.output_text.delta",
                    "item_id": item_id,
                    "output_index": output_index,
                    "content_index": 0,
                    "delta": text,
                },
            )
        self.write_sse(
            "response.output_text.done",
            {
                "type": "response.output_text.done",
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": text,
            },
        )
        self.write_sse(
            "response.content_part.done",
            {
                "type": "response.content_part.done",
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": part,
            },
        )
        self.write_sse(
            "response.output_item.done",
            {"type": "response.output_item.done", "output_index": output_index, "item": item},
        )

    def write_function_call_events(self, item: dict[str, Any], output_index: int) -> None:
        in_progress = {**item, "status": "in_progress", "arguments": ""}
        self.write_sse(
            "response.output_item.added",
            {"type": "response.output_item.added", "output_index": output_index, "item": in_progress},
        )
        arguments = str(item.get("arguments") or "{}")
        if arguments:
            self.write_sse(
                "response.function_call_arguments.delta",
                {
                    "type": "response.function_call_arguments.delta",
                    "item_id": item["id"],
                    "output_index": output_index,
                    "delta": arguments,
                },
            )
        self.write_sse(
            "response.function_call_arguments.done",
            {
                "type": "response.function_call_arguments.done",
                "item_id": item["id"],
                "output_index": output_index,
                "arguments": arguments,
            },
        )
        self.write_sse(
            "response.output_item.done",
            {"type": "response.output_item.done", "output_index": output_index, "item": item},
        )

    def write_events(self, response: dict[str, Any]) -> None:
        created = {**response, "status": "in_progress", "output": []}
        self.write_sse("response.created", {"type": "response.created", "response": created})
        for output_index, item in enumerate(response["output"]):
            if item.get("type") == "function_call":
                self.write_function_call_events(item, output_index)
            else:
                self.write_message_events(item, output_index)
        self.write_sse("response.completed", {"type": "response.completed", "response": response})
        self.write_sse("done", "[DONE]")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=Config.host)
    parser.add_argument("--port", type=int, default=Config.port)
    parser.add_argument("--ds4", default=Config.ds4_base_url)
    parser.add_argument("--model", default=Config.model)
    parser.add_argument("--max-tokens", type=int, default=Config.max_tokens)
    args = parser.parse_args()

    Config.host = args.host
    Config.port = args.port
    Config.ds4_base_url = args.ds4
    Config.model = args.model
    Config.max_tokens = args.max_tokens

    httpd = ThreadingHTTPServer((Config.host, Config.port), Handler)
    print(f"ds4 responses shim listening on http://{Config.host}:{Config.port}", flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
