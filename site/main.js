(function () {
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function applyMotionPreference() {
    if (motionQuery.matches) {
      document.body.classList.add("is-reduced-motion");
    } else {
      document.body.classList.remove("is-reduced-motion");
    }
  }

  function markLoaded() {
    document.body.classList.add("is-loaded");
  }

  function markGifLoaded(frame) {
    frame.classList.add("is-gif-loaded");
  }

  applyMotionPreference();
  motionQuery.addEventListener("change", applyMotionPreference);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }

  function onReady() {
    var gif = document.querySelector(".hero__preview-gif");
    var frame = document.querySelector(".hero__preview-frame");

    if (gif && frame) {
      if (gif.complete && gif.naturalWidth > 1) {
        markGifLoaded(frame);
      } else {
        gif.addEventListener("load", function () {
          if (gif.naturalWidth > 1) {
            markGifLoaded(frame);
          }
        });
      }
    }

    if (motionQuery.matches) {
      document.body.classList.add("is-loaded");
      return;
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(markLoaded).catch(markLoaded);
    } else {
      markLoaded();
    }
  }
})();
