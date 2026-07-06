const totalPhotos = 44;
const gallery = document.querySelector("[data-gallery]");
const lightbox = document.querySelector("[data-lightbox]");
const lightboxImage = document.querySelector("[data-lightbox-image]");
const caption = document.querySelector("[data-lightbox-caption]");
const closeButton = document.querySelector("[data-close]");
const prevButton = document.querySelector("[data-prev]");
const nextButton = document.querySelector("[data-next]");

let activeIndex = 0;

function photoPath(index) {
  return `photos/photo-${String(index + 1).padStart(3, "0")}.jpg`;
}

function openPhoto(index) {
  activeIndex = index;
  lightboxImage.src = photoPath(index);
  lightboxImage.alt = `调色摄影作品 ${index + 1}`;
  caption.textContent = `作品 ${String(index + 1).padStart(2, "0")} / ${totalPhotos}`;
  document.body.classList.add("is-locked");
  lightbox.showModal();
}

function closePhoto() {
  document.body.classList.remove("is-locked");
  lightbox.close();
}

function movePhoto(direction) {
  activeIndex = (activeIndex + direction + totalPhotos) % totalPhotos;
  openPhoto(activeIndex);
}

for (let index = 0; index < totalPhotos; index += 1) {
  const button = document.createElement("button");
  const image = document.createElement("img");

  button.className = "photo";
  button.type = "button";
  button.setAttribute("aria-label", `查看作品 ${index + 1}`);
  image.src = photoPath(index);
  image.alt = `调色摄影作品 ${index + 1}`;
  image.loading = index < 4 ? "eager" : "lazy";

  button.append(image);
  button.addEventListener("click", () => openPhoto(index));
  gallery.append(button);
}

closeButton.addEventListener("click", closePhoto);
prevButton.addEventListener("click", () => movePhoto(-1));
nextButton.addEventListener("click", () => movePhoto(1));

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closePhoto();
  }
});

document.addEventListener("keydown", (event) => {
  if (!lightbox.open) {
    return;
  }

  if (event.key === "Escape") {
    document.body.classList.remove("is-locked");
  }

  if (event.key === "ArrowLeft") {
    movePhoto(-1);
  }

  if (event.key === "ArrowRight") {
    movePhoto(1);
  }
});
