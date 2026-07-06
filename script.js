const sourcePhotos = (window.SITE_PHOTOS || []).map((photo, index) => ({
  id: `generated-${index + 1}`,
  src: normalizeAsset(photo.src),
  title: photo.title || `作品 ${String(index + 1).padStart(2, "0")}`
}));

function generatedImages(start, count) {
  return sourcePhotos.slice(start - 1, start - 1 + count).map((photo) => ({
    image: photo.src,
    title: photo.title
  }));
}

const defaultData = {
  siteName: "调色",
  browserTitle: "调色 | 摄影作品集",
  footerText: "© 2026 调色. All rights reserved.",
  theme: {
    background: "#f8f5ef",
    text: "#171717",
    accent: "#b45f2a",
    button: "#25493f"
  },
  hero: {
    eyebrow: "Photo Collection",
    title: "调色",
    subtitle: "摄影作品集",
    cover: "photos/photo-001.jpg"
  },
  sections: [
    {
      id: "selected",
      type: "spotlight",
      kicker: "Featured",
      title: "精选作品",
      text: "用色彩、光线和现场感组织一次观看。",
      layout: "rail",
      images: generatedImages(1, 5)
    },
    {
      id: "story",
      type: "story",
      kicker: "Story",
      title: "主题故事",
      text: "这里可以放一组拍摄主题、项目说明、客户案例或旅行记录。",
      layout: "rail",
      images: generatedImages(4, 6)
    },
    {
      id: "gallery",
      type: "gallery",
      kicker: "Works",
      title: "全部作品",
      text: "",
      layout: "masonry",
      useAllPhotos: true,
      images: []
    },
    {
      id: "contact",
      type: "contact",
      kicker: "Contact",
      title: "联系摄影师",
      text: "品牌、肖像、城市纪实或长期项目，都可以先从一封简短邮件开始。",
      contactText: "hello@example.com",
      contactUrl: "mailto:hello@example.com"
    }
  ]
};

let siteData = clone(defaultData);
let activeLightboxPhotos = [];
let activeLightboxIndex = 0;

const dom = {
  brand: document.querySelector("[data-brand]"),
  header: document.querySelector("[data-header]"),
  nav: document.querySelector("[data-nav]"),
  hero: document.querySelector("[data-hero]"),
  sections: document.querySelector("[data-sections]"),
  footer: document.querySelector("[data-footer]"),
  lightbox: document.querySelector("[data-lightbox]"),
  lightboxImage: document.querySelector("[data-lightbox-image]"),
  lightboxCaption: document.querySelector("[data-lightbox-caption]")
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAsset(value = "") {
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return String(value).replace(/^\/+/, "");
}

function normalizeId(value, fallback) {
  const id = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function normalizeImages(images = [], fallbackPrefix = "cms") {
  return images
    .map((item, index) => {
      const src = normalizeAsset(item.image || item.src || item);
      if (!src) return null;
      return {
        id: `${fallbackPrefix}-${index + 1}`,
        src,
        title: item.title || `作品 ${String(index + 1).padStart(2, "0")}`
      };
    })
    .filter(Boolean);
}

function normalizeData(content) {
  const data = {
    ...clone(defaultData),
    ...(content || {}),
    theme: { ...defaultData.theme, ...(content?.theme || {}) },
    hero: { ...defaultData.hero, ...(content?.hero || {}) }
  };

  data.hero.cover = normalizeAsset(data.hero.cover || defaultData.hero.cover);
  data.sections = (content?.sections?.length ? content.sections : defaultData.sections).map((section, index) => ({
    ...section,
    id: normalizeId(section.id || section.title, `section-${index + 1}`),
    type: section.type || "spotlight",
    layout: section.layout || (section.type === "gallery" ? "masonry" : "rail"),
    images: Array.isArray(section.images) ? section.images : []
  }));

  return data;
}

async function loadCmsContent() {
  try {
    const response = await fetch("content/site.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`CMS content ${response.status}`);
    return normalizeData(await response.json());
  } catch (error) {
    console.warn("Using default site content.", error);
    return normalizeData(defaultData);
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function sectionPhotos(section) {
  if (section.type === "gallery" && (section.useAllPhotos || !section.images?.length)) {
    return sourcePhotos;
  }

  const photos = normalizeImages(section.images || [], section.id);
  if (photos.length) return photos;
  return sourcePhotos.slice(0, section.type === "gallery" ? sourcePhotos.length : 6);
}

function applyTheme() {
  document.title = siteData.browserTitle || siteData.siteName;
  document.documentElement.style.setProperty("--paper", siteData.theme.background);
  document.documentElement.style.setProperty("--ink", siteData.theme.text);
  document.documentElement.style.setProperty("--accent", siteData.theme.accent);
  document.documentElement.style.setProperty("--deep", siteData.theme.button);
  dom.brand.textContent = siteData.siteName;
  dom.footer.textContent = siteData.footerText;
}

function renderHero() {
  dom.hero.innerHTML = `
    <img src="${escapeHtml(siteData.hero.cover)}" alt="${escapeHtml(siteData.hero.title)}">
    <div class="hero-overlay"></div>
    <div class="hero-copy">
      <p>${escapeHtml(siteData.hero.eyebrow)}</p>
      <h1>${escapeHtml(siteData.hero.title)}</h1>
      <span>${escapeHtml(siteData.hero.subtitle)}</span>
    </div>
  `;
}

function renderNav() {
  dom.nav.innerHTML = siteData.sections
    .map((section) => `<a href="#${section.id}">${escapeHtml(section.title || section.kicker || "板块")}</a>`)
    .join("");
}

function renderRail(section, photos) {
  return `
    <div class="rail-shell">
      <button class="rail-arrow rail-left" type="button" data-scroll-rail="${section.id}" data-direction="-1" aria-label="向左滑动">‹</button>
      <div class="image-rail" data-rail="${section.id}">
        ${photos.map((photo, index) => `
          <button class="rail-card" type="button" data-open-section="${section.id}" data-photo-index="${index}">
            <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.title)}" loading="lazy">
            <span>${escapeHtml(photo.title)}</span>
          </button>
        `).join("")}
      </div>
      <button class="rail-arrow rail-right" type="button" data-scroll-rail="${section.id}" data-direction="1" aria-label="向右滑动">›</button>
    </div>
  `;
}

function renderSpotlight(section) {
  return `
    <section class="content-section spotlight" id="${section.id}">
      <div class="section-copy">
        <p class="kicker">${escapeHtml(section.kicker)}</p>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.text)}</p>
      </div>
      ${renderRail(section, sectionPhotos(section))}
    </section>
  `;
}

function renderStory(section) {
  return `
    <section class="content-section story-band" id="${section.id}">
      <div class="section-copy">
        <p class="kicker">${escapeHtml(section.kicker)}</p>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.text)}</p>
      </div>
      ${renderRail(section, sectionPhotos(section))}
    </section>
  `;
}

function renderPhotoButton(photo, index, photos) {
  const button = document.createElement("button");
  button.className = "photo-card";
  button.type = "button";
  button.innerHTML = `<img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.title)}" loading="${index < 4 ? "eager" : "lazy"}">`;
  button.addEventListener("click", () => openLightbox(photos, index));
  return button;
}

function renderGallery(section) {
  const photos = sectionPhotos(section);
  const wrapper = document.createElement("section");
  wrapper.className = `gallery-section ${section.layout || "masonry"}`;
  wrapper.id = section.id;
  wrapper.innerHTML = `
    <div class="section-heading">
      <p class="kicker">${escapeHtml(section.kicker)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.text ? `<p>${escapeHtml(section.text)}</p>` : ""}
    </div>
    <div class="gallery-grid"></div>
  `;
  const grid = wrapper.querySelector(".gallery-grid");
  photos.forEach((photo, index) => grid.append(renderPhotoButton(photo, index, photos)));
  return wrapper;
}

function renderContact(section) {
  return `
    <section class="contact-section" id="${section.id}">
      <div>
        <p class="kicker">${escapeHtml(section.kicker)}</p>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.text || "")}</p>
      </div>
      <a href="${escapeHtml(section.contactUrl || "mailto:hello@example.com")}">${escapeHtml(section.contactText || "联系我")}</a>
    </section>
  `;
}

function attachSectionHandlers(element, section) {
  const photos = sectionPhotos(section);
  element.querySelectorAll("[data-open-section]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(photos, Number(button.dataset.photoIndex || 0)));
  });
  element.querySelectorAll("[data-scroll-rail]").forEach((button) => {
    button.addEventListener("click", () => scrollRail(button.dataset.scrollRail, Number(button.dataset.direction || 1)));
  });
}

function scrollRail(id, direction) {
  const rail = document.querySelector(`[data-rail="${id}"]`);
  if (!rail) return;
  rail.scrollBy({ left: direction * Math.max(320, rail.clientWidth * 0.86), behavior: "smooth" });
}

function renderSections() {
  dom.sections.innerHTML = "";
  siteData.sections.forEach((section) => {
    if (section.type === "gallery") {
      dom.sections.append(renderGallery(section));
      return;
    }

    const template = document.createElement("template");
    if (section.type === "story") template.innerHTML = renderStory(section);
    else if (section.type === "contact") template.innerHTML = renderContact(section);
    else template.innerHTML = renderSpotlight(section);

    const element = template.content.firstElementChild;
    attachSectionHandlers(element, section);
    dom.sections.append(element);
  });
}

function renderSite() {
  applyTheme();
  renderHero();
  renderNav();
  renderSections();
}

function openLightbox(photos, index) {
  activeLightboxPhotos = photos;
  activeLightboxIndex = Math.max(0, index);
  const photo = activeLightboxPhotos[activeLightboxIndex];
  if (!photo) return;
  dom.lightboxImage.src = photo.src;
  dom.lightboxImage.alt = photo.title;
  dom.lightboxCaption.textContent = `${photo.title} / ${activeLightboxPhotos.length}`;
  document.body.classList.add("is-locked");
  dom.lightbox.showModal();
}

function moveLightbox(direction) {
  if (!activeLightboxPhotos.length) return;
  activeLightboxIndex = (activeLightboxIndex + direction + activeLightboxPhotos.length) % activeLightboxPhotos.length;
  openLightbox(activeLightboxPhotos, activeLightboxIndex);
}

function closeLightbox() {
  document.body.classList.remove("is-locked");
  dom.lightbox.close();
}

document.querySelector("[data-close-lightbox]").addEventListener("click", closeLightbox);
document.querySelector("[data-prev]").addEventListener("click", () => moveLightbox(-1));
document.querySelector("[data-next]").addEventListener("click", () => moveLightbox(1));

dom.lightbox.addEventListener("click", (event) => {
  if (event.target === dom.lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (!dom.lightbox.open) return;
  if (event.key === "Escape") document.body.classList.remove("is-locked");
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});

window.addEventListener("scroll", () => {
  dom.header.classList.toggle("is-solid", window.scrollY > 40);
}, { passive: true });

loadCmsContent().then((data) => {
  siteData = data;
  renderSite();
});
