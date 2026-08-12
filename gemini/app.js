document.addEventListener("DOMContentLoaded", () => {
  const contentEl = document.getElementById("content");
  const navItems = document.querySelectorAll(".nav-item");
  let appData = null;

  async function loadData() {
    try {
      const response = await fetch("raghu.json");
      if (!response.ok) throw new Error("Network response was not ok");
      appData = await response.json();
      renderPage("home");
    } catch (error) {
      contentEl.innerHTML = `
        <div class="card">
          <h3>Error Loading Data</h3>
          <p>Could not load content at this time.</p>
        </div>
      `;
    }
  }

  function renderPage(target) {
    if (!appData) return;

    if (target === "home") {
      contentEl.innerHTML = `
        <div class="card">
          <h2>${appData.title || "Welcome"}</h2>
          <p>${appData.description || "Overview of your application."}</p>
        </div>
      `;
    } else if (target === "reviews") {
      const reviews = appData.reviews || [];
      contentEl.innerHTML = reviews.length
        ? reviews
            .map(
              (r) => `
          <div class="card">
            <h3>${r.author || "Anonymous"}</h3>
            <p>${r.comment || ""}</p>
            <small>Rating: ${r.rating || 5}/5</small>
          </div>
        `
            )
            .join("")
        : '<div class="card"><p>No reviews available.</p></div>';
    } else if (target === "settings") {
      contentEl.innerHTML = `
        <div class="card">
          <h2>Settings</h2>
          <p>Version 1.0.0</p>
        </div>
      `;
    }
  }

  navItems.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget.getAttribute("data-target");
      navItems.forEach((i) => i.classList.remove("active"));
      e.currentTarget.classList.add("active");
      renderPage(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .catch((err) => console.error("Service Worker registration failed:", err));
  }

  loadData();
});