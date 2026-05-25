import asyncio
from openai import AsyncOpenAI

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

async def main():
    client = AsyncOpenAI(api_key="fake-key-for-test", base_url=GEMINI_BASE_URL)
    try:
        resp = await client.chat.completions.create(
            model="gemini-2.5-pro",
            messages=[{"role": "system", "content": "You are a bot"}, {"role": "user", "content": "hello"}],
            max_tokens=1024,
            temperature=0.85
        )
        print("Success:", resp)
    except Exception as e:
        print("Error:", type(e), e)

asyncio.run(main())
