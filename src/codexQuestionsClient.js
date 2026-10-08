function setupCodexQuestion(tile, slot) {
  const surface = tile.querySelector('.codex-question');
  surface.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || form.getAttribute('aria-busy') === 'true') return;
    const interaction = surface._interaction;
    if (!interaction) return;
    const currentSlot = Number(tile.dataset.slot);
    const answers = interaction.questions.map((question, index) => {
      const picked = form.querySelector('input[name="codex-' + currentSlot + '-' + index + '"]:checked') || form.querySelectorAll('.codex-question-set')[index].querySelector('input[type="radio"]:checked');
      const note = form.querySelector('[data-codex-note="' + index + '"]');
      return { questionId: question.id, optionIndex: picked ? Number(picked.value) : null, note: note ? note.value : '' };
    });
    form.setAttribute('aria-busy', 'true');
    for (const control of form.elements) control.disabled = true;
    const status = form.querySelector('.codex-question-status');
    status.textContent = 'Submitting…';
    const result = await post('answerCodexQuestion', { slot: currentSlot, callId: interaction.callId, answers });
    if (result && result.ok === false) {
      form.setAttribute('aria-busy', 'false');
      for (const control of form.elements) control.disabled = false;
      status.textContent = 'Could not submit. Refresh and try again.';
    } else {
      burstRefresh();
    }
  });
}

function syncCodexQuestion(tile, session) {
  const surface = tile.querySelector('.codex-question');
  const slot = Number(tile.dataset.slot);
  const interaction = session && session.interaction && session.interaction.type === 'codex-question' ? session.interaction : null;
  if (!interaction) {
    const focusWasInside = surface.contains(document.activeElement);
    const hadQuestion = !surface.hidden;
    surface.hidden = true;
    surface._interaction = null;
    surface.dataset.signature = '';
    tile.classList.remove('has-codex-question');
    if (hadQuestion && (focusWasInside || document.activeElement === document.body)) tile.querySelector('.prompt-input').focus({ preventScroll: true });
    return;
  }
  tile.classList.add('has-codex-question');
  surface.hidden = false;
  const signature = interaction.callId + ':' + JSON.stringify(interaction.questions);
  if (surface.dataset.signature === signature) return;
  surface.dataset.signature = signature;
  surface._interaction = interaction;
  const form = surface.querySelector('form');
  form.replaceChildren();
  form.setAttribute('aria-busy', 'false');
  interaction.questions.forEach((question, questionIndex) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'codex-question-set';
    const legend = document.createElement('legend');
    legend.className = 'codex-question-heading';
    legend.textContent = question.header || ('Question ' + (questionIndex + 1));
    fieldset.appendChild(legend);
    const prompt = document.createElement('p');
    prompt.className = 'codex-question-prompt';
    prompt.textContent = question.question;
    fieldset.appendChild(prompt);
    if (question.options.length) {
      const list = document.createElement('div');
      list.className = 'codex-option-list';
      const options = question.options.concat(question.allowOther ? [{ label: 'None of the above', description: 'Add a note with your own answer.' }] : []);
      options.forEach((option, optionIndex) => {
        const card = document.createElement('label');
        card.className = 'codex-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'codex-' + slot + '-' + questionIndex;
        input.value = String(optionIndex);
        input.required = true;
        input.setAttribute('aria-label', option.label);
        const label = document.createElement('span');
        label.className = 'codex-option-label';
        label.textContent = (optionIndex + 1) + '. ' + option.label;
        const description = document.createElement('span');
        description.className = 'codex-option-description';
        description.id = 'codex-option-description-' + slot + '-' + questionIndex + '-' + optionIndex;
        description.textContent = option.description;
        input.setAttribute('aria-describedby', description.id);
        card.append(input, label, description);
        list.appendChild(card);
      });
      fieldset.appendChild(list);
    }
    const noteLabel = document.createElement('label');
    noteLabel.className = 'codex-note-label';
    noteLabel.append(document.createTextNode(question.options.length ? 'Add note (optional)' : 'Your answer'));
    const note = document.createElement(question.secret ? 'input' : 'textarea');
    note.className = 'codex-note';
    note.dataset.codexNote = String(questionIndex);
    if (question.secret) note.type = 'password';
    else note.rows = 2;
    note.required = !question.options.length;
    note.setAttribute('aria-label', (question.header || 'Question') + (question.options.length ? ' note' : ' answer'));
    noteLabel.appendChild(note);
    fieldset.appendChild(noteLabel);
    form.appendChild(fieldset);
  });
  const actions = document.createElement('div');
  actions.className = 'codex-question-actions';
  const status = document.createElement('span');
  status.className = 'codex-question-status';
  status.setAttribute('role', 'status');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'codex-submit';
  submit.textContent = interaction.questions.length > 1 ? 'Submit answers' : 'Submit answer';
  actions.append(status, submit);
  form.appendChild(actions);
}
