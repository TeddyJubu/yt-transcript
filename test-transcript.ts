import { extractTranscript } from './src/transcript';

async function main() {
  const res = await extractTranscript('jNQXAC9IVRw'); // Random valid youtube ID
  console.log("Success! Title:", res.title);
  console.log("Transcript part:", res.transcript.substring(0, 100));
}
main();
