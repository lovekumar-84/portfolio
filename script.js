/* VidyaVantage — interactions
   All animation is transform/opacity via CSS classes; JS only observes and toggles. */
(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sticky nav ---------- */
  var nav = document.getElementById("nav");
  var lastScrolled = false;
  function onScroll() {
    var scrolled = window.scrollY > 24;
    if (scrolled !== lastScrolled) {
      nav.classList.toggle("is-scrolled", scrolled);
      lastScrolled = scrolled;
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile menu ---------- */
  var toggle = document.getElementById("navToggle");
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (open) nav.classList.add("is-scrolled");
  });
  document.querySelectorAll(".nav__mobile a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ---------- marquee: duplicate track content for a seamless loop ---------- */
  var track = document.getElementById("trustTrack");
  if (track && !prefersReducedMotion) {
    Array.prototype.slice.call(track.children).forEach(function (node) {
      var clone = node.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    });
  }

  /* ---------- scroll reveal ---------- */
  if (!("IntersectionObserver" in window)) {
    document.documentElement.classList.add("no-observer");
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ---------- contact form ---------- */
  var form = document.getElementById("contactForm");
  var status = document.getElementById("formStatus");

  function setFieldError(field, message) {
    field.classList.toggle("is-invalid", Boolean(message));
    var error = field.parentElement.querySelector(".form__error");
    if (message) {
      if (!error) {
        error = document.createElement("p");
        error.className = "form__error";
        error.id = field.id + "-error";
        field.parentElement.appendChild(error);
      }
      error.textContent = message;
      field.setAttribute("aria-describedby", error.id);
      field.setAttribute("aria-invalid", "true");
    } else if (error) {
      error.remove();
      field.removeAttribute("aria-describedby");
      field.removeAttribute("aria-invalid");
    }
  }

  function messageFor(field) {
    if (field.validity.valueMissing) {
      return field.tagName === "SELECT" ? "Please choose one option." : "Please fill in this field.";
    }
    if (field.validity.typeMismatch && field.type === "email") {
      return "That doesn't look like an email address — check for typos.";
    }
    return "";
  }

  // validate on blur, not on every keystroke
  form.querySelectorAll("input, select, textarea").forEach(function (field) {
    field.addEventListener("blur", function () {
      setFieldError(field, messageFor(field));
    });
    field.addEventListener("input", function () {
      if (field.classList.contains("is-invalid") && messageFor(field) === "") {
        setFieldError(field, "");
      }
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var firstInvalid = null;
    form.querySelectorAll("input, select, textarea").forEach(function (field) {
      var message = messageFor(field);
      setFieldError(field, message);
      if (message && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
      firstInvalid.focus();
      status.textContent = "";
      return;
    }

    // No backend is wired up yet: simulate the round-trip, then show success.
    var button = form.querySelector("button[type=submit]");
    var label = button.querySelector(".btn__label");
    button.classList.add("is-loading");
    button.disabled = true;
    label.textContent = "Sending…";
    window.setTimeout(function () {
      button.classList.remove("is-loading");
      button.disabled = false;
      label.textContent = "Book consultation";
      form.reset();
      status.textContent = "Thank you — we'll reply within one working day.";
    }, 900);
  });
})();
