import app from './src/index';

async function testSse() {
  const req = new Request('http://localhost/api/extract_transcripts_stream?urls=["https://www.youtube.com/watch?v=jNQXAC9IVRw"]');
  const res = await app.fetch(req);
  console.log("Status:", res.status);
  
  if (res.body) {
    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log(decoder.decode(value));
    }
  }
}
testSse();
