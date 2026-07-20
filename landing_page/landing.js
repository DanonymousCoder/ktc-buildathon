const form = document.querySelector('.waitlist-form');
const note = document.querySelector('#form-note');

form?.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();

  if (!email) {
    note.textContent = 'Enter your email and we will keep you posted.';
    return;
  }

  const entries = JSON.parse(localStorage.getItem('flowtrakka_waitlist') || '[]');
  const nextEntries = Array.from(new Set([...entries, email]));
  localStorage.setItem('flowtrakka_waitlist', JSON.stringify(nextEntries));
  note.textContent = 'You are on the list. FlowTrakka will keep it quiet until launch.';
  form.reset();
});
