/*!
 *
 *  # # Bibi Extension: Page Exporter
 *
 *  * Export pages as images (single/spread) or PDF
 *  * Coded by Claude Opus 4.6
 *
 */

Bibi.x({
  id: "PageExporter",
  description: "Export pages as images (single/spread) or PDF",
  author: "Claude Opus 4.6",
  version: "1.0.0"
})((function () {
  "use strict";

  // ── CDN URLs ──
  const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.1/jspdf.umd.min.js";
  const HTML2CANVAS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

  // ── State ──
  let direction = "R2L"; // default, updated from EPUB metadata
  let allPages = [];     // flat array of { item, pageIndex, pageInItem }
  let panelEl = null;
  let toggleBtn = null;
  let pollId = null;
  var originalTitle = document.title; // preserve page title before Bibi changes it

  // ── Utility Functions ──

  function isMobile() {
    return /iPhone|iPad|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  }

  function truncateText(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + "\u2026";
  }

  function buildBaseFilename(author, title) {
    const a = author ? "[" + sanitizeFilename(truncateText(author, 15)) + "] " : "";
    const t = sanitizeFilename(truncateText(title, 40));
    return a + t;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
      var s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Failed to load: " + url)); };
      document.head.appendChild(s);
    });
  }

  // ── Book Metadata ──

  function getBookTitle() {
    try {
      var t = B && B.Package && B.Package.Metadata && B.Package.Metadata["title"];
      if (t) return Array.isArray(t) ? t[0] : t;
    } catch (e) {}
    try { if (B && B.Title) return B.Title; } catch (e) {}
    return document.title || "Untitled";
  }

  function getBookAuthor() {
    try {
      var c = B && B.Package && B.Package.Metadata && B.Package.Metadata["creator"];
      if (c) return Array.isArray(c) ? c[0] : c;
    } catch (e) {}
    return "";
  }

  function getBookDirection() {
    try { if (B && B.PPD) return B.PPD === "rtl" ? "R2L" : "L2R"; } catch (e) {}
    try { if (S && S["page-progression-direction"]) return S["page-progression-direction"] === "rtl" ? "R2L" : "L2R"; } catch (e) {}
    try {
      if (document.documentElement.className.includes("page-rtl")) return "R2L";
      if (document.documentElement.className.includes("page-ltr")) return "L2R";
    } catch (e) {}
    return "R2L";
  }

  // ── Page Enumeration ──

  function buildPageList() {
    allPages = [];
    if (!R || !R.Items) return;
    var globalIdx = 0;
    R.Items.forEach(function (item) {
      if (item.Pages && item.Pages.length) {
        item.Pages.forEach(function (page, pi) {
          allPages.push({ item: item, page: page, pageInItem: pi, globalIndex: globalIdx });
          globalIdx++;
        });
      } else {
        allPages.push({ item: item, page: null, pageInItem: 0, globalIndex: globalIdx });
        globalIdx++;
      }
    });
  }

  // ── Current Page Detection ──

  function getCurrentPageIndex() {
    try {
      // Try R.Current approach
      if (R.Current && R.Current.Pages && R.Current.Pages.length > 0) {
        var cp = R.Current.Pages[0];
        for (var i = 0; i < allPages.length; i++) {
          if (allPages[i].page === cp) return i;
        }
      }
    } catch (e) {}
    try {
      // Fallback: PageObserver
      if (H && H.PageObserver && H.PageObserver.Current && H.PageObserver.Current.Pages) {
        var pages = H.PageObserver.Current.Pages;
        if (pages.length > 0) {
          for (var i = 0; i < allPages.length; i++) {
            if (allPages[i].page === pages[0]) return i;
          }
        }
      }
    } catch (e) {}
    return 0;
  }

  function getCurrentSpreadPages() {
    var indices = [];
    try {
      if (R.Current && R.Current.Pages && R.Current.Pages.length > 0) {
        for (var p = 0; p < R.Current.Pages.length; p++) {
          var cp = R.Current.Pages[p];
          for (var i = 0; i < allPages.length; i++) {
            if (allPages[i].page === cp) { indices.push(i); break; }
          }
        }
      }
    } catch (e) {}
    if (indices.length === 0) {
      try {
        if (H && H.PageObserver && H.PageObserver.Current && H.PageObserver.Current.Pages) {
          var pages = H.PageObserver.Current.Pages;
          for (var p = 0; p < pages.length; p++) {
            for (var i = 0; i < allPages.length; i++) {
              if (allPages[i].page === pages[p]) { indices.push(i); break; }
            }
          }
        }
      } catch (e) {}
    }
    if (indices.length === 0) indices.push(0);
    return indices;
  }

  // ── Page Capture ──

  function getPageDrawable(pageIdx) {
    return new Promise(function (resolve, reject) {
      if (pageIdx < 0 || pageIdx >= allPages.length) {
        return reject(new Error("Page index out of range: " + pageIdx));
      }

      var entry = allPages[pageIdx];
      var item = entry.item;

      // item.HTML = <html> element inside iframe (NOT the iframe element itself)
      // item.Body = <body> element inside iframe
      // item.contentDocument = the iframe's document
      // item.Box = <div> wrapper in main document containing the iframe
      var doc = item.contentDocument;
      if (!doc) return reject(new Error("No contentDocument"));

      var body = item.Body || doc.body || doc.documentElement;

      // Strategy 1: Look for dominant image (fixed-layout / manga)
      var imgs = doc.querySelectorAll("img");
      var svgImages = doc.querySelectorAll("svg image, image");
      var bodyRect = body.getBoundingClientRect();
      var bodyArea = bodyRect.width * bodyRect.height;

      // Check for large <img>
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var r = img.getBoundingClientRect();
        if (r.width * r.height > bodyArea * 0.3) {
          // Dominant image found — draw directly to canvas
          var canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || r.width;
          canvas.height = img.naturalHeight || r.height;
          try {
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            return resolve(canvas);
          } catch (e) {
            // Tainted canvas, fall through to html2canvas
            break;
          }
        }
      }

      // Check for large SVG <image>
      for (var j = 0; j < svgImages.length; j++) {
        var svgImg = svgImages[j];
        var href = svgImg.getAttribute("href") || svgImg.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (href) {
          var tempImg = new Image();
          tempImg.crossOrigin = "anonymous";
          tempImg.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = tempImg.naturalWidth;
            canvas.height = tempImg.naturalHeight;
            canvas.getContext("2d").drawImage(tempImg, 0, 0);
            resolve(canvas);
          };
          tempImg.onerror = function () {
            captureWithHtml2Canvas(item, entry.pageInItem).then(resolve).catch(reject);
          };
          try {
            tempImg.src = new URL(href, doc.baseURI).href;
          } catch (e) {
            tempImg.src = href;
          }
          return;
        }
      }

      // Strategy 2: html2canvas inside the iframe
      captureWithHtml2Canvas(item, entry.pageInItem).then(resolve).catch(reject);
    });
  }

  function captureWithHtml2Canvas(item, pageInItem) {
    var doc = item.contentDocument;
    var iframeWin = doc.defaultView;
    var body = item.Body || doc.body;
    var html = doc.documentElement;

    // Load html2canvas inside the iframe (cross-document capture fails from parent)
    var loadPromise;
    if (iframeWin.html2canvas) {
      loadPromise = Promise.resolve();
    } else {
      loadPromise = new Promise(function (resolve, reject) {
        var script = doc.createElement("script");
        script.src = HTML2CANVAS_CDN;
        script.onload = resolve;
        script.onerror = function () { reject(new Error("Failed to load html2canvas in iframe")); };
        doc.head.appendChild(script);
      });
    }

    return loadPromise.then(function () {
      // Bibi sets inline "background: transparent" on body, hiding the original CSS background.
      // Temporarily remove it so html2canvas sees the real background.
      var origBg = body.style.background;
      body.style.background = "";

      var isColumned = item.Columned && item.Pages && item.Pages.length > 1;

      if (isColumned) {
        // Multi-column items: html2canvas's standard renderer cannot handle CSS columns.
        // Use foreignObjectRendering which leverages the browser's native SVG foreignObject
        // rendering, correctly supporting CSS multi-column layout.
        // Render the full content (all columns), then crop to the target page.
        var cs = iframeWin.getComputedStyle(html);
        var colW = parseFloat(cs.columnWidth) || html.clientHeight;
        var colGap = parseFloat(cs.columnGap) || 0;
        var wm = cs.writingMode || "";
        var isVertical = wm.indexOf("vertical") >= 0;

        return iframeWin.html2canvas(html, {
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: true,
          scale: 1,
          logging: false,
          backgroundColor: "#ffffff"
        }).then(function (fullCanvas) {
          body.style.background = origBg;

          // Crop to the target column/page
          var cropCanvas = document.createElement("canvas");
          var ctx = cropCanvas.getContext("2d");

          if (isVertical) {
            // vertical-rl: columns stack vertically
            var yOffset = pageInItem * (colW + colGap);
            cropCanvas.width = fullCanvas.width;
            cropCanvas.height = colW;
            ctx.drawImage(fullCanvas, 0, yOffset, fullCanvas.width, colW, 0, 0, fullCanvas.width, colW);
          } else {
            // horizontal-tb: columns stack horizontally
            var xOffset = pageInItem * (colW + colGap);
            cropCanvas.width = colW;
            cropCanvas.height = fullCanvas.height;
            ctx.drawImage(fullCanvas, xOffset, 0, colW, fullCanvas.height, 0, 0, colW, fullCanvas.height);
          }

          return cropCanvas;
        }).catch(function (err) {
          body.style.background = origBg;
          throw err;
        });
      }

      // Single-column items: standard html2canvas rendering
      return iframeWin.html2canvas(body, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        logging: false,
        backgroundColor: "#ffffff"
      }).then(function (canvas) {
        body.style.background = origBg;
        return canvas;
      }).catch(function (err) {
        body.style.background = origBg;
        throw err;
      });
    });
  }

  // ── Page Text Extraction ──

  function getPageText(pageIdx) {
    try {
      var entry = allPages[pageIdx];
      var doc = entry.item.contentDocument;
      var body = entry.item.Body || doc.body;
      return (body.innerText || "").trim();
    } catch (e) { return ""; }
  }

  // ── Single Page Download ──

  function downloadPage(pageIdx, btn) {
    var origText = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;
    getPageDrawable(pageIdx).then(function (canvas) {
      var num = String(pageIdx + 1).padStart(String(allPages.length).length, "0");
      var filename = buildBaseFilename(getBookAuthor(), getBookTitle()) + "_" + num + ".jpg";
      canvas.toBlob(function (blob) {
        downloadBlob(blob, filename);
        btn.textContent = "OK";
        btn.style.background = "#4CAF50";
        setTimeout(function () { btn.textContent = origText; btn.style.background = "#2196F3"; btn.disabled = false; }, 1500);
      }, "image/jpeg", 0.95);
    }).catch(function (e) {
      console.error("[PageExporter] DL failed:", e);
      btn.textContent = "NG";
      btn.style.background = "#f44336";
      setTimeout(function () { btn.textContent = origText; btn.style.background = "#2196F3"; btn.disabled = false; }, 1500);
    });
  }

  // ── Spread Download ──

  function downloadSpread(pageIdx, btn) {
    var origText = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;

    var done = function (ok) {
      btn.textContent = ok ? "OK" : "NG";
      btn.style.background = ok ? "#4CAF50" : "#f44336";
      setTimeout(function () { btn.textContent = origText; btn.style.background = "#e91e63"; btn.disabled = false; }, 1500);
    };

    if (pageIdx + 1 >= allPages.length) { done(false); return; }

    var pageA = pageIdx, pageB = pageIdx + 1;

    Promise.all([getPageDrawable(pageA), getPageDrawable(pageB)]).then(function (results) {
      var canvasA = results[0], canvasB = results[1];
      var wA = canvasA.width, hA = canvasA.height;
      var wB = canvasB.width, hB = canvasB.height;

      var spread = document.createElement("canvas");
      spread.width = wA + wB;
      spread.height = Math.max(hA, hB);
      var ctx = spread.getContext("2d");

      if (direction === "R2L") {
        // Right-to-left: [pageB (next) | pageA (current)]
        ctx.drawImage(canvasB, 0, 0);
        ctx.drawImage(canvasA, wB, 0);
      } else {
        // Left-to-right: [pageA (current) | pageB (next)]
        ctx.drawImage(canvasA, 0, 0);
        ctx.drawImage(canvasB, wA, 0);
      }

      var padLen = String(allPages.length).length;
      var num1 = String(pageA + 1).padStart(padLen, "0");
      var num2 = String(pageB + 1).padStart(padLen, "0");
      var filename = buildBaseFilename(getBookAuthor(), getBookTitle()) + "_" + num1 + "-" + num2 + ".jpg";

      spread.toBlob(function (blob) {
        downloadBlob(blob, filename);
        done(true);
      }, "image/jpeg", 0.95);
    }).catch(function (e) {
      console.error("[PageExporter] Spread DL failed:", e);
      done(false);
    });
  }

  // ── PDF Generation ──

  function generatePDF(btn) {
    var origText = btn.textContent;
    btn.textContent = "0/" + allPages.length;
    btn.disabled = true;

    loadScript(JSPDF_CDN).then(function () {
      var jsPDF = (globalThis.jspdf || window.jspdf).jsPDF;
      var doc = new jsPDF({ unit: "px", hotfixes: ["px_scaling"] });

      var title = getBookTitle();
      var author = getBookAuthor();
      doc.setProperties({
        title: title,
        author: author,
        subject: location.href,
        creator: "Bibi PageExporter"
      });

      var pdfDirection = direction === "R2L" ? "R2L" : "L2R";
      var pageLayout = direction === "R2L" ? "TwoPageRight" : "TwoPageLeft";
      doc.viewerPreferences({ Direction: pdfDirection, PageLayout: pageLayout });

      var idx = 0;
      function processPage() {
        if (idx >= allPages.length) {
          // Save
          var pdfName = buildBaseFilename(author, title) + ".pdf";
          var isIOS = /iPhone|iPad/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

          if (isIOS) {
            var blob = doc.output("blob");
            var file = new File([blob], pdfName, { type: "application/pdf" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file] }).catch(function () {});
            } else {
              var dlBlob = new Blob([blob], { type: "application/octet-stream" });
              downloadBlob(dlBlob, pdfName);
            }
          } else {
            doc.save(pdfName);
          }

          btn.textContent = "Done!";
          btn.style.background = "#4CAF50";
          setTimeout(function () { btn.textContent = origText; btn.style.background = "#9C27B0"; btn.disabled = false; }, 2000);
          return;
        }

        getPageDrawable(idx).then(function (canvas) {
          var w = canvas.width, h = canvas.height;
          var imgData = canvas.toDataURL("image/jpeg", 0.92);
          if (idx === 0) {
            doc.deletePage(1);
            doc.addPage([w, h]);
          } else {
            doc.addPage([w, h]);
          }
          doc.addImage(imgData, "JPEG", 0, 0, w, h);

          // Add invisible text layer for searchability
          var text = getPageText(idx);
          if (text) {
            doc.internal.write("3 Tr"); // PDF text rendering mode 3 = invisible
            doc.setFontSize(1);
            doc.text(text, 0, 10);
            doc.internal.write("0 Tr"); // reset to fill mode
          }

          idx++;
          btn.textContent = idx + "/" + allPages.length;
          setTimeout(processPage, 10); // yield to UI
        }).catch(function (e) {
          console.error("[PageExporter] PDF page " + idx + " failed:", e);
          idx++;
          btn.textContent = idx + "/" + allPages.length;
          setTimeout(processPage, 10);
        });
      }

      processPage();
    }).catch(function (e) {
      console.error("[PageExporter] jsPDF load failed:", e);
      btn.textContent = "NG";
      btn.style.background = "#f44336";
      setTimeout(function () { btn.textContent = origText; btn.style.background = "#9C27B0"; btn.disabled = false; }, 2000);
    });
  }

  // ── DL All ──

  function downloadAll(btn) {
    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "0/" + allPages.length;
    var idx = 0;

    function next() {
      if (idx >= allPages.length) {
        btn.textContent = "Done!";
        btn.style.background = "#4CAF50";
        setTimeout(function () { btn.textContent = origText; btn.style.background = "#FF9800"; btn.disabled = false; }, 2000);
        return;
      }
      getPageDrawable(idx).then(function (canvas) {
        var num = String(idx + 1).padStart(String(allPages.length).length, "0");
        var filename = buildBaseFilename(getBookAuthor(), getBookTitle()) + "_" + num + ".jpg";
        canvas.toBlob(function (blob) {
          downloadBlob(blob, filename);
          idx++;
          btn.textContent = idx + "/" + allPages.length;
          setTimeout(next, 300);
        }, "image/jpeg", 0.95);
      }).catch(function (e) {
        console.error("[PageExporter] DL All page " + idx + " failed:", e);
        idx++;
        btn.textContent = idx + "/" + allPages.length;
        setTimeout(next, 300);
      });
    }
    next();
  }

  // ── Button Factory ──

  function mkBtn(text, bg, action) {
    var b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      background: bg, color: "#fff", border: "none", borderRadius: "4px",
      padding: "4px 10px", cursor: "pointer", fontSize: "12px", fontFamily: "monospace",
      minWidth: "32px", touchAction: "manipulation", lineHeight: "1.4"
    });
    b.addEventListener("click", function () { action(b); });
    return b;
  }

  // ── Toggle Button ──

  var panelHidden = false; // true when user clicked Close

  function createToggleButton() {
    if (toggleBtn) return;
    var mobile = isMobile();

    toggleBtn = document.createElement("button");
    toggleBtn.textContent = "\u{1F4E5}";  // 📥
    toggleBtn.title = "Show Page Exporter";
    Object.assign(toggleBtn.style, {
      position: "fixed", zIndex: "999998",
      background: "#1a1a1a", color: "#fff", border: "1px solid #555",
      borderRadius: "50%", width: "40px", height: "40px",
      fontSize: "18px", cursor: "pointer", lineHeight: "1",
      boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
      touchAction: "manipulation", padding: "0",
      display: "none", // managed by syncToggleWithBibiMenu
      transition: "opacity 0.15s linear",
      opacity: "0"
    });

    if (mobile) {
      Object.assign(toggleBtn.style, {
        bottom: "max(50px, calc(10px + env(safe-area-inset-bottom, 40px)))",
        right: "10px"
      });
    } else {
      // Below Bibi menubar (typically 40px), left side to avoid right-side arrows
      Object.assign(toggleBtn.style, { top: "44px", left: "10px" });
    }

    // Prevent event propagation to Bibi viewer
    ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"].forEach(function (evt) {
      toggleBtn.addEventListener(evt, function (e) { e.stopPropagation(); });
    });

    toggleBtn.addEventListener("click", function () {
      showPanel();
    });
    document.body.appendChild(toggleBtn);

    // Sync toggle button visibility with Bibi's menubar hover state
    syncToggleWithBibiMenu();
  }

  function syncToggleWithBibiMenu() {
    var bibiMenu = document.getElementById("bibi-menu");
    if (!bibiMenu) return;

    function updateToggleVisibility() {
      if (!toggleBtn) return;
      var menuVisible = bibiMenu.classList.contains("hover");
      if (panelHidden && menuVisible) {
        // Panel closed + Bibi menu showing → show toggle button
        toggleBtn.style.display = "";
        // Force reflow then fade in
        void toggleBtn.offsetWidth;
        toggleBtn.style.opacity = "1";
      } else {
        // Panel open OR Bibi menu hidden → hide toggle button
        toggleBtn.style.opacity = "0";
        // Hide after fade-out transition
        setTimeout(function () {
          if (toggleBtn && toggleBtn.style.opacity === "0") {
            toggleBtn.style.display = "none";
          }
        }, 160);
      }
    }

    new MutationObserver(updateToggleVisibility)
      .observe(bibiMenu, { attributes: true, attributeFilter: ["class"] });

    // Initial sync
    updateToggleVisibility();
  }

  function showPanel() {
    panelHidden = false;
    if (toggleBtn) { toggleBtn.style.opacity = "0"; toggleBtn.style.display = "none"; }
    createPanel();
  }

  function hidePanel() {
    panelHidden = true;
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (panelEl) { panelEl.remove(); panelEl = null; }
    // Toggle button visibility is now managed by syncToggleWithBibiMenu
    // Trigger an immediate check
    var bibiMenu = document.getElementById("bibi-menu");
    if (bibiMenu && bibiMenu.classList.contains("hover") && toggleBtn) {
      toggleBtn.style.display = "";
      void toggleBtn.offsetWidth;
      toggleBtn.style.opacity = "1";
    }
  }

  // ── UI Panel ──

  function createPanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; if (pollId) clearInterval(pollId); }

    buildPageList();
    if (!allPages.length) { console.warn("[PageExporter] No pages found."); return; }

    direction = getBookDirection();
    var mobile = isMobile();

    panelEl = document.createElement("div");
    Object.assign(panelEl.style, {
      position: "fixed", zIndex: "999999",
      background: "#1a1a1a", color: "#eee", border: "1px solid #555",
      borderRadius: "8px", padding: "8px",
      fontSize: "13px", fontFamily: "monospace",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
    });

    // Prevent event propagation to Bibi viewer
    ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"].forEach(function (evt) {
      panelEl.addEventListener(evt, function (e) { e.stopPropagation(); });
    });

    var cur = getCurrentPageIndex();
    createCompactUI(cur);

    document.body.appendChild(panelEl);
    if (toggleBtn) toggleBtn.style.display = "none";
  }

  // ── Compact UI (shared for desktop & mobile) ──

  function createCompactUI(cur) {
    var mobile = isMobile();
    if (mobile) {
      Object.assign(panelEl.style, {
        bottom: "max(50px, calc(10px + env(safe-area-inset-bottom, 40px)))",
        left: "10px", right: "10px"
      });
    } else {
      Object.assign(panelEl.style, {
        top: "44px", left: "10px"
      });
    }

    var navRow = document.createElement("div");
    Object.assign(navRow.style, { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" });

    var pageLabel = document.createElement("span");
    pageLabel.style.cssText = "flex:1; text-align:center; font-size:13px; min-width:50px;";

    var curSpread = [cur];
    var dlContainer = document.createElement("span");
    dlContainer.style.display = "contents";
    var lastDLKey = "";

    function update() {
      curSpread = getCurrentSpreadPages();
      if (curSpread.length === 0) curSpread = [cur];
      cur = curSpread[0];
      if (curSpread.length >= 2) {
        var sorted = curSpread.slice().sort(function (a, b) { return a - b; });
        pageLabel.textContent = (sorted[0] + 1) + "-" + (sorted[1] + 1) + " / " + allPages.length;
      } else {
        pageLabel.textContent = (cur + 1) + " / " + allPages.length;
      }
      updateDLButtons();
    }

    function updateDLButtons() {
      var sorted = curSpread.slice().sort(function (a, b) { return a - b; });
      var key = curSpread.length + ":" + sorted.join(",");
      if (key === lastDLKey) return;
      lastDLKey = key;
      while (dlContainer.firstChild) dlContainer.removeChild(dlContainer.firstChild);

      if (curSpread.length >= 2) {
        var leftIdx, rightIdx;
        if (direction === "R2L") {
          leftIdx = sorted[1];
          rightIdx = sorted[0];
        } else {
          leftIdx = sorted[0];
          rightIdx = sorted[1];
        }
        var dlL = mkBtn("DL" + (leftIdx + 1), "#2196F3", function (b) { downloadPage(leftIdx, b); });
        dlL.title = "Download Page " + (leftIdx + 1);
        dlContainer.appendChild(dlL);
        var dlR = mkBtn("DL" + (rightIdx + 1), "#2196F3", function (b) { downloadPage(rightIdx, b); });
        dlR.title = "Download Page " + (rightIdx + 1);
        dlContainer.appendChild(dlR);
      } else {
        var dlBtn = mkBtn("DL", "#2196F3", function (b) { downloadPage(curSpread[0], b); });
        dlBtn.title = "Download Current Page";
        dlContainer.appendChild(dlBtn);
      }
    }

    update();

    var prevBtn = mkBtn("\u25C0", "#555", function () { E.dispatch("bibi:commands:move-by", direction === "R2L" ? 1 : -1); });
    prevBtn.title = "Previous Page";
    var nextBtn = mkBtn("\u25B6", "#555", function () { E.dispatch("bibi:commands:move-by", direction === "R2L" ? -1 : 1); });
    nextBtn.title = "Next Page";
    var dl2Btn = mkBtn("2P", "#e91e63", function (b) { downloadSpread(cur, b); });
    dl2Btn.title = "Download Spread (2 Pages)";
    var dlAllBtn = mkBtn("All", "#FF9800", function (b) { downloadAll(b); });
    dlAllBtn.title = "Download All Pages";
    var pdfBtn = mkBtn("PDF", "#9C27B0", function (b) { generatePDF(b); });
    pdfBtn.title = "Export as PDF";
    var dirBtn = mkBtn(direction, "#607D8B", function (b) {
      direction = direction === "R2L" ? "L2R" : "R2L";
      b.textContent = direction;
      lastDLKey = "";
      updateDLButtons();
    });
    dirBtn.title = "Toggle Page Direction";
    var closeBtn = mkBtn("X", "#666", function () { hidePanel(); });
    closeBtn.title = "Hide Panel";
    var closeBookBtn = mkBtn("\u2612", "#a33", function (b) {
      if (!b._confirmed) {
        b._confirmed = true;
        b.textContent = "\u2612?";
        b.style.background = "#c00";
        setTimeout(function () { b._confirmed = false; b.textContent = "\u2612"; b.style.background = "#a33"; }, 2000);
        return;
      }
      closeBook();
    });
    closeBookBtn.title = "Close Book (Click twice to confirm)";

    navRow.appendChild(prevBtn);
    navRow.appendChild(pageLabel);
    navRow.appendChild(nextBtn);
    navRow.appendChild(dlContainer);
    navRow.appendChild(dl2Btn);
    navRow.appendChild(dlAllBtn);
    navRow.appendChild(pdfBtn);
    navRow.appendChild(dirBtn);
    navRow.appendChild(closeBtn);
    navRow.appendChild(closeBookBtn);
    panelEl.appendChild(navRow);

    // Page tracking
    pollId = setInterval(function () {
      var p = getCurrentPageIndex();
      if (p >= 0 && p !== cur) { cur = p; update(); }
    }, 1000);
  }

  // ── Close Book ──

  function closeBook() {
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (panelEl) { panelEl.remove(); panelEl = null; }
    if (toggleBtn) { toggleBtn.remove(); toggleBtn = null; }
    if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
    allPages = [];
    window.location.href = window.location.pathname;
  }

  // ── IndexedDB helpers for D&D file relay ──

  var DB_NAME = "PageExporterDB";
  var DB_STORE = "files";
  var DB_KEY = "pendingFile";

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) { e.target.result.createObjectStore(DB_STORE); };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function storePendingFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        openDB().then(function (db) {
          var tx = db.transaction(DB_STORE, "readwrite");
          tx.objectStore(DB_STORE).put({ buffer: reader.result, name: file.name, type: file.type }, DB_KEY);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        }).catch(reject);
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function loadPendingFile() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        var store = tx.objectStore(DB_STORE);
        var getReq = store.get(DB_KEY);
        getReq.onsuccess = function () {
          var data = getReq.result;
          if (data) store.delete(DB_KEY);
          resolve(data || null);
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  // ── D&D overlay when book is open ──

  var dropOverlay = null;
  var dragCounter = 0;

  function setupDropHandler() {
    // Create overlay (hidden by default)
    dropOverlay = document.createElement("div");
    Object.assign(dropOverlay.style, {
      position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
      zIndex: "1000000", background: "rgba(33,150,243,0.25)",
      display: "none", alignItems: "center", justifyContent: "center",
      pointerEvents: "none"
    });
    var label = document.createElement("div");
    Object.assign(label.style, {
      background: "#1a1a1a", color: "#fff", padding: "24px 48px",
      borderRadius: "12px", fontSize: "20px", fontFamily: "monospace",
      border: "3px dashed #2196F3", pointerEvents: "none"
    });
    label.textContent = "\u{1F4D6} Drop EPUB / ZIP to open";
    dropOverlay.appendChild(label);
    document.body.appendChild(dropOverlay);

    dragCounter = 0;

    document.addEventListener("dragenter", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf("Files") < 0) return;
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        dropOverlay.style.display = "flex";
      }
    });

    document.addEventListener("dragleave", function (e) {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropOverlay.style.display = "none";
      }
    });

    document.addEventListener("dragover", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf("Files") < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    document.addEventListener("drop", function (e) {
      dragCounter = 0;
      dropOverlay.style.display = "none";

      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.(epub|zip)$/i.test(file.name)) return;

      e.preventDefault();
      e.stopPropagation();

      // Show loading indicator on panel
      if (panelEl) {
        var msg = document.createElement("div");
        msg.textContent = "Loading: " + file.name;
        Object.assign(msg.style, { padding: "4px 0", fontSize: "11px", color: "#aaa" });
        panelEl.appendChild(msg);
      }

      storePendingFile(file).then(function () {
        window.location.href = window.location.pathname;
      }).catch(function (err) {
        console.error("[PageExporter] Failed to store file for reload:", err);
      });
    });
  }

  // ── Auto-feed pending file to Catcher on reload ──

  function feedPendingFileToCatcher() {
    loadPendingFile().then(function (data) {
      if (!data) return;
      console.log("[PageExporter] Found pending file:", data.name);

      var file = new File([data.buffer], data.name, { type: data.type });

      function tryFeed() {
        var catcher = document.getElementById("bibi-catcher");
        if (!catcher) {
          setTimeout(tryFeed, 100);
          return;
        }
        // Dispatch synthetic drop event to Catcher
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          var dropEvt = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
          catcher.dispatchEvent(dropEvt);
          console.log("[PageExporter] Auto-fed file to Catcher:", data.name);
        } catch (err) {
          console.error("[PageExporter] Auto-feed failed:", err);
        }
      }
      tryFeed();
    }).catch(function (err) {
      console.error("[PageExporter] Failed to load pending file:", err);
    });
  }

  // ── Title Lock ──
  // Prevent Bibi from changing the page title to the book filename

  function lockTitle() {
    document.title = originalTitle;
    var titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(function () {
        if (document.title !== originalTitle) {
          document.title = originalTitle;
        }
      }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  // ── Initialize ──

  // On extension load: check for pending D&D file and auto-feed to Catcher
  feedPendingFileToCatcher();

  E.add("bibi:opened", function () {
    console.log("[PageExporter] Book opened, initializing...");
    lockTitle();
    setTimeout(function () {
      createToggleButton();
      createPanel();
      setupDropHandler();
    }, 500);
  });

}));
