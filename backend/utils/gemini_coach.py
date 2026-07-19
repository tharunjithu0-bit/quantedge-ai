"""
utils/gemini_coach.py
----------------------
Wraps calls to Google Gemini for the "Gemini Trading Coach" feature.

Gemini's job here is strictly interpretive: it receives statistics that
the app has ALREADY computed client-side (win rate, best/worst setup,
patterns, recommendations, streaks, etc. — see computeInsights() in
AICoach.tsx) and turns them into coaching prose. It never computes,
recalculates, or invents any numbers itself, and it is explicitly told
not to give market predictions or financial advice.

Model selection
----------------
No model name is hardcoded. Two modes:

- GEMINI_MODEL is set in the environment -> that exact model is used.
  If it's unavailable for this API key, generate_coaching_analysis()
  raises a clear GeminiRequestError instead of crashing; it does not
  silently swap in a different model.
- GEMINI_MODEL is unset -> DEFAULT_MODEL_CANDIDATES is tried in order,
  falling through to the next candidate only when the failure looks
  like "this model isn't available to me" (404 / NOT_FOUND / not
  supported for generateContent). Any other kind of failure (bad API
  key, network error, quota, etc.) is surfaced immediately since
  trying another model wouldn't fix it.

DEFAULT_MODEL_CANDIDATES leads with "gemini-flash-latest" — an alias
Google keeps pointed at its current generally-available Flash model —
so this stays correct as models are deprecated/replaced over time,
rather than needing a code change every time a specific dated model ID
is sunset.
"""

import json
import os

from google import genai
from google.genai import types, errors

# Tried in order when GEMINI_MODEL is not set. "gemini-flash-latest" is an
# auto-updated alias for whatever Flash model is currently GA, so it's the
# most future-proof default. The pinned names behind it are just a safety
# net for API keys/projects where the alias itself isn't resolvable yet.
DEFAULT_MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
]

_client = None


class GeminiConfigError(Exception):
    """Raised when the Gemini client can't be constructed (e.g. missing API key)."""


class GeminiRequestError(Exception):
    """Raised when the Gemini API call fails or returns something unusable."""


def _get_client() -> "genai.Client":
    """
    Lazily builds a single shared genai.Client. The API key is read from
    the environment only — never accepted from a request, never hardcoded.
    """
    global _client
    if _client is not None:
        return _client

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise GeminiConfigError(
            "GEMINI_API_KEY is not set. Add it to your environment (e.g. a .env "
            "file loaded via python-dotenv, or your process manager's env config) "
            "before calling POST /api/ai/analyze."
        )

    _client = genai.Client(api_key=api_key)
    return _client


def _model_candidates() -> list[str]:
    """
    GEMINI_MODEL in the environment pins a single model — respected exactly,
    no silent fallback. Otherwise, try DEFAULT_MODEL_CANDIDATES in order.
    """
    configured = os.environ.get("GEMINI_MODEL", "").strip()
    if configured:
        return [configured]
    return list(DEFAULT_MODEL_CANDIDATES)


def _is_model_unavailable_error(exc: Exception) -> bool:
    """
    True when the failure means "this model id isn't valid/available for
    this API key" (as opposed to auth, quota, network, or server errors —
    which trying a different model won't fix).
    """
    code = getattr(exc, "code", None)
    if code == 404:
        return True
    message = str(exc).lower()
    return (
        "not_found" in message
        or "not found" in message
        or "is not supported for" in message
    )


# Gemini is forced into exactly this shape via response_schema. We still
# double-check the parsed JSON below in case of any SDK/model edge cases.
RESPONSE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "performance_summary": types.Schema(type=types.Type.STRING),
        "biggest_opportunity": types.Schema(type=types.Type.STRING),
        "biggest_risk": types.Schema(type=types.Type.STRING),
        "next_action": types.Schema(type=types.Type.STRING),
    },
    required=[
        "performance_summary",
        "biggest_opportunity",
        "biggest_risk",
        "next_action",
    ],
)

SYSTEM_INSTRUCTION = """You are a professional trading performance assistant reviewing a \
trader's journal statistics.

You must NEVER:
- Predict future price moves or market direction.
- Give financial, investment, or trading advice (e.g. "buy X", "the market will do Y").
- Invent, estimate, round differently, or alter any statistic. Every number you \
reference must come directly from the data you were given.
- Mention assets, setups, dates, or figures that are not present in the supplied data.

You must return exactly four fields, each 1–2 sentences, concise and direct — no \
preamble, no filler, no repeating the same point across fields:

- performance_summary: A brief, neutral read of how the trader is doing overall, \
grounded in the supplied metrics (e.g. win rate, net P&L, trade count).
- biggest_opportunity: The single most promising pattern in the data worth leaning \
into (e.g. a strong setup, asset, or side of the market) and why.
- biggest_risk: The single most concerning pattern in the data worth addressing \
(e.g. a weak setup, a losing streak, an oversized loss profile) and why.
- next_action: One concrete, process-level action the trader can take next — never \
a market call, always about their own process (sizing, setup selection, discipline, \
review habits).

Keep the tone direct and professional, grounded entirely in the data you're given. \
Respond only with the requested JSON structure — no markdown, no commentary outside it."""


def _call_gemini(client: "genai.Client", model_name: str, prompt: str):
    return client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            temperature=0.4,
        ),
    )


def generate_coaching_analysis(insights: dict) -> dict:
    """
    Calls Gemini with already-computed trading statistics and returns a
    structured coaching analysis.

    `insights` is the JSON-serializable payload built client-side in
    AICoach.tsx's computeInsights() (metrics, patterns, recommendations,
    weekly review) — it contains no raw trade rows and no numbers Gemini
    is expected to compute itself.
    """
    client = _get_client()

    prompt = (
        "Here is a trader's already-computed performance data. Use ONLY this "
        "data — do not invent, assume, or calculate anything beyond it:\n\n"
        f"{json.dumps(insights, indent=2)}"
    )

    candidates = _model_candidates()
    configured_model = os.environ.get("GEMINI_MODEL", "").strip()

    response = None
    tried: list[str] = []
    last_error: Exception | None = None

    for model_name in candidates:
        tried.append(model_name)
        try:
            response = _call_gemini(client, model_name, prompt)
            break
        except (errors.ClientError, errors.ServerError) as e:
            last_error = e

            if configured_model:
                # The caller pinned a specific model via GEMINI_MODEL — don't
                # silently swap it out for something else, just fail clearly.
                raise GeminiRequestError(
                    f"Configured Gemini model '{configured_model}' is unavailable: {e}. "
                    "Set GEMINI_MODEL in your .env to a model your API key supports "
                    "(e.g. 'gemini-flash-latest', 'gemini-3.5-flash'), or unset it to "
                    "let the backend pick a supported Flash model automatically."
                ) from e

            if _is_model_unavailable_error(e):
                # Try the next candidate in DEFAULT_MODEL_CANDIDATES.
                continue

            # Not a model-availability problem (auth, quota, server error, ...) —
            # trying another model name wouldn't help, so fail now.
            raise GeminiRequestError(f"Gemini request failed: {e}") from e
        except Exception as e:
            last_error = e
            raise GeminiRequestError(f"Gemini request failed: {e}") from e

    if response is None:
        raise GeminiRequestError(
            "No supported Gemini Flash model is available for this API key. Tried: "
            f"{', '.join(tried)}. Set GEMINI_MODEL in your .env to a model listed for "
            "your account in Google AI Studio. Last error: "
            f"{last_error}"
        )

    raw_text = getattr(response, "text", None)
    if not raw_text:
        raise GeminiRequestError("Gemini returned an empty response.")

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise GeminiRequestError(f"Gemini returned malformed JSON: {e}") from e

    required_fields = [
        "performance_summary",
        "biggest_opportunity",
        "biggest_risk",
        "next_action",
    ]
    missing = [f for f in required_fields if f not in parsed]
    if missing:
        raise GeminiRequestError(f"Gemini response missing fields: {', '.join(missing)}")

    return parsed