const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite:generateContent';

export async function summarizeWithGemini(
  apiKey: string,
  transcript: string,
  title: string,
): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                'Summarize the following YouTube video transcript. Provide:\n' +
                '1. A brief overall summary (2-3 sentences)\n' +
                '2. Key points discussed\n' +
                '3. Main takeaways\n\n' +
                `Video Title: ${title}\n\n` +
                `Transcript:\n${transcript.slice(0, 30000)}`,
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}
