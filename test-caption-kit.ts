import { YtCaptionKit } from 'yt-caption-kit';

async function main() {
  try {
    const api = new YtCaptionKit();
    const transcript = await api.fetch('jNQXAC9IVRw');
    console.log("Success! Language:", transcript.language);
    
    // The library has a method toRawData()
    const raw = transcript.toRawData();
    console.log("Transcript length:", raw.length);
  } catch (e: any) {
    console.error("Error with yt-caption-kit:", e.message);
  }
}
main();
