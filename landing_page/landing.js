const waitlistForms = document.querySelectorAll('[data-waitlist-form]');
const apiBase = document.querySelector('meta[name="flowtrakka-api-base"]')?.content?.replace(/\/$/, '');
const chromeWebStoreUrl = 'https://chromewebstore.google.com/detail/flowtrakka-document-focus/bhbljihknmkdfmijnlhhodhngiibagka';
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

const featureContent = {
  tracking: {
    index: '01 / 04',
    title: 'Automatic Tracking',
    description: 'FlowTrakka detects supported PDFs, slides, docs, and sheets, then measures active focus time quietly in the background.',
    signal: 'Live',
    meter: '92%',
    points: ['Active-tab aware', 'No manual timer'],
  },
  detection: {
    index: '02 / 04',
    title: 'Smart Detection',
    description: 'Tab focus, browser activity, idle state, and document type work together so forgotten tabs never inflate your study record.',
    signal: '4 signals',
    meter: '78%',
    points: ['Idle-state aware', 'Distraction resistant'],
  },
  privacy: {
    index: '03 / 04',
    title: 'Privacy First',
    description: 'Your tracking history stays in local Chrome storage by default. Leaderboard sharing remains optional and aggregate-only.',
    signal: 'Local',
    meter: '100%',
    points: ['Content never read', 'Sharing is opt-in'],
  },
  students: {
    index: '04 / 04',
    title: 'Built for Students',
    description: 'Review daily patterns, export your own logs, and compare aggregate progress without turning focused work into noisy gamification.',
    signal: 'Ready',
    meter: '86%',
    points: ['Exportable records', 'Academic workflow'],
  },
};

const featureNodes = document.querySelectorAll('.orbit-node');
const featureDetail = document.querySelector('.orbit-detail');

featureNodes.forEach(node => {
  node.addEventListener('click', () => {
    const feature = featureContent[node.dataset.feature];
    if (!feature || !featureDetail) return;

    featureNodes.forEach(item => {
      const active = item === node;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });

    featureDetail.querySelector('.orbit-index').textContent = feature.index;
    featureDetail.querySelector('h3').textContent = feature.title;
    featureDetail.querySelector('p').textContent = feature.description;
    featureDetail.querySelector('.orbit-signal strong').textContent = feature.signal;
    featureDetail.querySelector('.orbit-meter span').style.width = feature.meter;
    featureDetail.querySelector('.orbit-points').innerHTML = feature.points.map(point => `<li>${point}</li>`).join('');
  });
});

waitlistForms.forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const note = form.parentElement.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const originalButtonText = button?.textContent || 'Get Started';

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

      if (note) note.textContent = 'You are on the list. FlowTrakka will keep it quiet until launch.';
      form.reset();
      window.location.assign(chromeWebStoreUrl);
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
