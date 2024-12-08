chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const mimeType = downloadItem.mime || "";
  let folder = "Autres";

  if (mimeType.startsWith("image/")) {
    folder = "Images";
  } else if (mimeType.startsWith("video/")) {
    folder = "Vidéos";
  } else if (mimeType.startsWith("audio/")) {
    folder = "Audios";
  } else if (mimeType.startsWith("application/")) {
    folder = "Documents";
  } else {
    const extension = downloadItem.filename.split(".").pop().toLowerCase();

    if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(extension)) {
      folder = "Images";
    } else if (["mp4", "avi", "mkv", "webm", "mov"].includes(extension)) {
      folder = "Vidéos";
    } else if (["mp3", "wav", "aac", "flac", "ogg"].includes(extension)) {
      folder = "Audios";
    } else if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(extension)) {
      folder = "Documents";
    }
  }

  const newFilename = `${folder}/${downloadItem.filename}`;
  suggest({ filename: newFilename });
});