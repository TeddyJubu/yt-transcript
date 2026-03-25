import { YtCaptionKit } from 'yt-caption-kit';

const api = new YtCaptionKit();
api.fetch('jNQXAC9IVRw')
  .then(t => {
    console.log("Language:", t.language);
    console.log("Length:", t.toRawData().length);
    console.log("First snippet:", t.snippets[0]);
  })
  .catch(e => console.error("Error:", e.message));
