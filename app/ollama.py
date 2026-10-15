"""Thin async client for the local Ollama server."""
from __future__ import annotations

import json
import os
from typing import AsyncIterator

import httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
NUM_CTX = int(os.environ.get("NUM_CTX", "8192"))

_client = httpx.AsyncClient(base_url=OLLAMA_URL, timeout=httpx.Timeout(10.0, read=None))


class OllamaError(Exception):
    pass


def _unreachable() -> OllamaError:
    return OllamaError(f"Can't reach Ollama at {OLLAMA_URL}. Start Ollama, then try again.")


def _error_text(body: str) -> str:
    try:
        return json.loads(body).get("error", body)
    except ValueError:
        return body


async def close() -> None:
    await _client.aclose()


async def list_models() -> list[dict]:
    """Installed models with the details the model picker shows."""
    try:
        r = await _client.get("/api/tags")
        r.raise_for_status()
    except httpx.ConnectError:
        raise _unreachable()
    except httpx.HTTPError as e:
        raise OllamaError(str(e))
    models = []
    for m in r.json().get("models", []):
        d = m.get("details") or {}
        models.append({
            "name": m["name"],
            "family": d.get("family", ""),
            "parameter_size": d.get("parameter_size", ""),
            "quantization": d.get("quantization_level", ""),
            "parent_model": d.get("parent_model", ""),
            "size": m.get("size", 0),
        })
    return sorted(models, key=lambda m: m["name"])


async def stream_chat(model: str, messages: list[dict], options: dict | None = None) -> AsyncIterator[dict]:
    """Yield Ollama's streamed chat chunks as dicts."""
    body = {"model": model, "messages": messages, "stream": True,
            "options": {"num_ctx": NUM_CTX, **(options or {})}}
    try:
        async with _client.stream("POST", "/api/chat", json=body) as r:
            if r.status_code != 200:
                detail = (await r.aread()).decode(errors="replace")
                raise OllamaError(f"Ollama returned {r.status_code}: {_error_text(detail)}")
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if chunk.get("error"):
                    raise OllamaError(chunk["error"])
                yield chunk
    except httpx.ConnectError:
        raise _unreachable()
    except httpx.HTTPError as e:
        raise OllamaError(str(e) or type(e).__name__)


async def complete(model: str, messages: list[dict], *, json_mode: bool = False,
                   options: dict | None = None) -> str:
    """Single non-streamed reply. Used for titles and memory extraction."""
    body = {"model": model, "messages": messages, "stream": False,
            "options": {"num_ctx": NUM_CTX, **(options or {})}}
    if json_mode:
        body["format"] = "json"
    try:
        r = await _client.post("/api/chat", json=body, timeout=httpx.Timeout(10.0, read=180.0))
    except httpx.ConnectError:
        raise _unreachable()
    except httpx.HTTPError as e:
        raise OllamaError(str(e) or type(e).__name__)
    if r.status_code != 200:
        raise OllamaError(f"Ollama returned {r.status_code}: {_error_text(r.text)}")
    return r.json().get("message", {}).get("content", "")
