chrome.downloads.onDeterminingFilename.addEventListener((downloadItem, suggest) => {
  let folder = "Autres";

  if (downloadItem.mime.startsWith("image/")) {
    folder = "Images";
  } else if (downloadItem.mime.startsWith("video/")) {
    folder = "Vidéos";
  } else if (downloadItem.mime.startsWith("audio/")) {
    folder = "Audios";
  } else if (downloadItem.mime.startsWith("application/")) {
    folder = "Documents";
  }

  const newFilename = `${folder}/${downloadItem.filename}`;
  suggest({ filename: newFilename });
});