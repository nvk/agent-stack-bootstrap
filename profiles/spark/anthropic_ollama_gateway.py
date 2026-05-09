#!/usr/bin/env python3
"""Minimal Anthropic Messages gateway for Ollama's OpenAI-compatible API.

This is intentionally small and local-only. It exists so Claude Code can point
ANTHROPIC_BASE_URL at localhost while the actual model runs in Ollama on Spark.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)

    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        block_type = block.get("type")
        if block_type == "text":
            parts.append(str(block.get("text", "")))
        elif block_type == "tool_result":
            value = block.get("content", "")
            parts.append("Tool result:\n" + _text_from_content(value))
    return "\n".join(part for part in parts if part)


def _system_text(system: Any) -> str:
    if isinstance(system, str):
        return system
    return _text_from_content(system)


def _convert_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    system = _system_text(payload.get("system"))
    if system:
        messages.append({"role": "system", "content": system})

    for message in payload.get("messages", []):
        role = message.get("role", "user")
        content = message.get("content", "")

        if isinstance(content, list):
            assistant_text: list[str] = []
            tool_calls: list[dict[str, Any]] = []
            pending_user_text: list[str] = []

            for block in content:
                if not isinstance(block, dict):
                    pending_user_text.append(str(block))
                    continue
                block_type = block.get("type")
                if block_type == "text":
                    text = str(block.get("text", ""))
                    if role == "assistant":
                        assistant_text.append(text)
                    else:
                        pending_user_text.append(text)
                elif block_type == "tool_use" and role == "assistant":
                    tool_calls.append(
                        {
                            "id": block.get("id", f"toolu_{int(time.time() * 1000)}"),
                            "type": "function",
                            "function": {
                                "name": block.get("name", "tool"),
                                "arguments": json.dumps(block.get("input", {})),
                            },
                        }
                    )
                elif block_type == "tool_result":
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": block.get("tool_use_id", "toolu_unknown"),
                            "content": _text_from_content(block.get("content", "")),
                        }
                    )

            if role == "assistant":
                out: dict[str, Any] = {"role": "assistant", "content": "\n".join(assistant_text)}
                if tool_calls:
                    out["tool_calls"] = tool_calls
                messages.append(out)
            elif pending_user_text:
                messages.append({"role": role, "content": "\n".join(pending_user_text)})
        else:
            messages.append({"role": role, "content": _text_from_content(content)})

    return messages


def _convert_tools(payload: dict[str, Any]) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    for tool in payload.get("tools", []) or []:
        if not isinstance(tool, dict):
            continue
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": tool.get("name", "tool"),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {"type": "object"}),
                },
            }
        )
    return tools


def _parse_qwen_tool_markup(text: str) -> list[dict[str, Any]]:
    """Parse Qwen-style textual tool calls into Anthropic tool_use blocks."""
    if "<function=" not in text:
        return []

    calls: list[dict[str, Any]] = []
    for match in re.finditer(r"<function=([A-Za-z0-9_.:-]+)>\s*(.*?)\s*</function>", text, flags=re.DOTALL):
        name = match.group(1)
        body = match.group(2)
        args: dict[str, Any] = {}
        for param in re.finditer(
            r"<parameter=([A-Za-z0-9_.:-]+)>\s*(.*?)\s*</parameter>",
            body,
            flags=re.DOTALL,
        ):
            key = param.group(1)
            value = param.group(2).strip()
            args[key] = value

        args = _normalize_tool_args(name, args)
        calls.append(
            {
                "type": "tool_use",
                "id": f"toolu_{int(time.time() * 1000)}_{len(calls)}",
                "name": name,
                "input": args,
            }
        )
    return calls


def _normalize_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle common local-model argument aliases for Claude Code tools."""
    normalized = dict(args)
    lower_name = name.lower()

    if lower_name == "bash" and "command" not in normalized:
        for alias in ("cmd", "shell", "bash", "script"):
            if alias in normalized:
                normalized["command"] = normalized[alias]
                break

    if lower_name == "read" and "file_path" not in normalized:
        for alias in ("path", "file", "filepath", "filename"):
            if alias in normalized:
                normalized["file_path"] = normalized[alias]
                break

    if lower_name == "grep" and "pattern" not in normalized:
        for alias in ("regex", "query", "search", "text"):
            if alias in normalized:
                normalized["pattern"] = normalized[alias]
                break

    return normalized


def _anthropic_content_from_openai(message: dict[str, Any]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    text = message.get("content") or ""
    parsed_tool_calls = _parse_qwen_tool_markup(text)
    if parsed_tool_calls:
        content.extend(parsed_tool_calls)
    elif text:
        content.append({"type": "text", "text": text})

    for tool_call in message.get("tool_calls") or []:
        function = tool_call.get("function") or {}
        raw_args = function.get("arguments") or "{}"
        try:
            args = json.loads(raw_args)
        except Exception:
            args = {"raw": raw_args}
        args = _normalize_tool_args(function.get("name", "tool"), args)
        content.append(
            {
                "type": "tool_use",
                "id": tool_call.get("id", f"toolu_{int(time.time() * 1000)}"),
                "name": function.get("name", "tool"),
                "input": args,
            }
        )
    return content or [{"type": "text", "text": ""}]


def _usage(openai_response: dict[str, Any]) -> dict[str, int]:
    usage = openai_response.get("usage") or {}
    return {
        "input_tokens": int(usage.get("prompt_tokens") or 0),
        "output_tokens": int(usage.get("completion_tokens") or 0),
    }


class Gateway(BaseHTTPRequestHandler):
    server_version = "spark-ollama-anthropic/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.server.verbose:
            super().log_message(fmt, *args)

    def _json_response(self, status: int, obj: dict[str, Any]) -> None:
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        return json.loads(body.decode("utf-8"))

    def _ollama_chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_payload: dict[str, Any] = {
            "model": payload.get("model") or self.server.model,
            "messages": _convert_messages(payload),
            "stream": False,
        }
        if payload.get("max_tokens"):
            request_payload["max_tokens"] = payload["max_tokens"]
        if payload.get("temperature") is not None:
            request_payload["temperature"] = payload["temperature"]

        tools = _convert_tools(payload)
        if tools:
            request_payload["tools"] = tools
            request_payload["tool_choice"] = "auto"

        data = json.dumps(request_payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.server.ollama}/v1/chat/completions",
            data=data,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.server.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"Ollama HTTP {exc.code}: {detail}") from exc

    def _anthropic_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._ollama_chat(payload)
        choice = (response.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = _anthropic_content_from_openai(message)
        stop_reason = "tool_use" if any(block.get("type") == "tool_use" for block in content) else "end_turn"
        return {
            "id": response.get("id", f"msg_{int(time.time() * 1000)}"),
            "type": "message",
            "role": "assistant",
            "model": payload.get("model") or self.server.model,
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": _usage(response),
        }

    def _stream_anthropic_message(self, message: dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()

        def send(event: str, data: dict[str, Any]) -> None:
            self.wfile.write(f"event: {event}\n".encode("utf-8"))
            self.wfile.write(f"data: {json.dumps(data)}\n\n".encode("utf-8"))
            self.wfile.flush()

        start = dict(message)
        start["content"] = []
        send("message_start", {"type": "message_start", "message": start})
        for index, block in enumerate(message["content"]):
            content_block = block
            if block.get("type") == "tool_use":
                content_block = {
                    "type": "tool_use",
                    "id": block.get("id"),
                    "name": block.get("name"),
                    "input": {},
                }

            send("content_block_start", {"type": "content_block_start", "index": index, "content_block": content_block})
            if block.get("type") == "text" and block.get("text"):
                send(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {"type": "text_delta", "text": block["text"]},
                    },
                )
            elif block.get("type") == "tool_use":
                send(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": json.dumps(block.get("input", {})),
                        },
                    },
                )
            send("content_block_stop", {"type": "content_block_stop", "index": index})
        send(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": message["stop_reason"], "stop_sequence": None},
                "usage": {"output_tokens": message["usage"]["output_tokens"]},
            },
        )
        send("message_stop", {"type": "message_stop"})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/health"):
            self._json_response(200, {"ok": True, "model": self.server.model, "ollama": self.server.ollama})
        elif path == "/v1/models":
            self._json_response(
                200,
                {
                    "data": [
                        {
                            "id": self.server.model,
                            "type": "model",
                            "display_name": "Spark Qwen3 Coder 30B",
                        }
                    ]
                },
            )
        else:
            self._json_response(404, {"error": {"message": f"not found: {path}"}})

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            payload = self._read_json()
            if path == "/v1/messages/count_tokens":
                text = _system_text(payload.get("system")) + "\n" + "\n".join(
                    _text_from_content(message.get("content", "")) for message in payload.get("messages", [])
                )
                self._json_response(200, {"input_tokens": max(1, len(text) // 4)})
            elif path == "/v1/messages":
                message = self._anthropic_message(payload)
                if payload.get("stream"):
                    self._stream_anthropic_message(message)
                else:
                    self._json_response(200, message)
            else:
                self._json_response(404, {"error": {"message": f"not found: {path}"}})
        except Exception as exc:
            self._json_response(500, {"error": {"type": "gateway_error", "message": str(exc)}})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4141)
    parser.add_argument("--ollama", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="qwen3-coder:30b")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Gateway)
    server.ollama = args.ollama.rstrip("/")
    server.model = args.model
    server.timeout = args.timeout
    server.verbose = args.verbose
    print(f"gateway listening on http://{args.host}:{args.port} -> {server.ollama} model={args.model}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
