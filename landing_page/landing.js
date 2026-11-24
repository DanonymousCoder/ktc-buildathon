const waitlistForms = document.querySelectorAll('[data-waitlist-form]');
const apiBase = document.querySelector('meta[name="flowtrakka-api-base"]')?.content?.replace(/\/$/, '');
const menuButton = document.querySelector('.menu-button');
const mobileMenu = document.querySelector('.mobile-menu');
const menuOverlay = document.querySelector('.menu-overlay');
const menuClose = document.querySelector('.menu-close');

function setMenuOpen(open) {
  if (!menuButton || !mobileMenu || !menuOverlay) return;

  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  mobileMenu.setAttribute('aria-hidden', String(!open));
  mobileMenu.toggleAttribute('inert', !open);
  mobileMenu.classList.toggle('is-open', open);
  menuOverlay.classList.toggle('is-open', open);
  menuOverlay.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';

  if (open) menuClose?.focus();
}

menuButton?.addEventListener('click', () => {
  setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
});

menuClose?.addEventListener('click', () => setMenuOpen(false));
menuOverlay?.addEventListener('click', () => setMenuOpen(false));

mobileMenu?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => setMenuOpen(false));
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    setMenuOpen(false);
    menuButton.focus();
  }
});

function initializeScrollReveals() {
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const revealGroups = [
    { selector: '.hero-copy', variant: 'reveal-left' },
    { selector: '.hero-panel', variant: 'reveal-scale' },
    { selector: '.intro > *', variant: 'reveal-up' },
    { selector: '.features-heading > *', variant: 'reveal-up' },
    { selector: '.orbit-node', variant: 'reveal-fade' },
    { selector: '.orbit-detail', variant: 'reveal-fade' },
    { selector: '.footer-brand, .footer-nav, .footer-signup', variant: 'reveal-up' },
    { selector: '.privacy-hero > *', variant: 'reveal-up' },
    { selector: '.privacy-card > *', variant: 'reveal-up' },
  ];

  const revealElements = [];

  revealGroups.forEach(({ selector, variant }) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      if (element.classList.contains('reveal-item')) return;
      element.classList.add('reveal-item', variant);
      element.style.setProperty('--reveal-delay', `${Math.min(index, 4) * 80}ms`);
      revealElements.push(element);
    });
  });

  document.body.classList.add('reveal-enabled');

  const revealObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );

  revealElements.forEach(element => revealObserver.observe(element));
}

initializeScrollReveals();

waitlistForms.forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const note = form.parentElement.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const originalButtonText = button?.textContent || 'Notify me';

    note?.classList.remove('is-error');

    if (!email) {
      note?.classList.add('is-error');
      if (note) note.textContent = 'Enter your email and we will keep you posted.';
      return;
    }

    if (!apiBase) {
      note?.classList.add('is-error');
      if (note) note.textContent = 'Waitlist service is not configured yet.';
      return;
    }

    form.setAttribute('aria-busy', 'true');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending...';
    }
    if (note) note.textContent = '';

    try {
      const response = await fetch(`${apiBase}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: form.dataset.waitlistSource || 'landing-page',
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'waitlist_subscription_failed');
      }

      if (note) note.textContent = form.dataset.success || 'You are on the list. We will keep you posted.';
      form.reset();
      if (form.dataset.redirect) window.location.assign(form.dataset.redirect);
    } catch {
      note?.classList.add('is-error');
      if (note) note.textContent = 'We could not save your email. Please try again.';
    } finally {
      form.removeAttribute('aria-busy');
      if (button) {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  });
});
