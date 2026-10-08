const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 9;
const MAX_TEXT = 12000;

function cleanText(value, limit = MAX_TEXT) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, limit).trim();
}

function normalizeRequest(payload) {
  let args;
  try { args = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : payload.arguments; } catch { return null; }
  if (!args || !Array.isArray(args.questions) || !args.questions.length) return null;
  const questions = args.questions.slice(0, MAX_QUESTIONS).map((question, questionIndex) => {
    const options = Array.isArray(question.options) ? question.options.slice(0, MAX_OPTIONS).map(option => ({
      label: cleanText(option && option.label, 1000),
      description: cleanText(option && option.description),
    })).filter(option => option.label) : [];
    return {
      id: cleanText(question.id, 200) || `question_${questionIndex + 1}`,
      header: cleanText(question.header, 1000),
      question: cleanText(question.question),
      options,
      // Current Codex rollout arguments omit this normalized TUI field even
      // though request_user_input adds its standard custom answer in the UI.
      allowOther: question.is_other !== false && options.length < MAX_OPTIONS,
      secret: question.is_secret === true,
    };
  }).filter(question => question.question || question.header);
  if (!questions.length) return null;
  const callId = cleanText(payload.call_id || payload.id, 300);
  if (!callId) return null;
  return { type: 'codex-question', callId, questions };
}

function activeQuestionFromJsonl(text) {
  let active = null;
  for (const line of String(text || '').split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const payload = event && event.payload || {};
    if (event.type === 'response_item' && payload.type === 'function_call' && payload.name === 'request_user_input') {
      active = normalizeRequest(payload);
      continue;
    }
    if (!active) continue;
    if (event.type === 'response_item' && payload.type === 'function_call_output' && payload.call_id === active.callId) {
      active = null;
      continue;
    }
    if (event.type === 'event_msg' && ['turn_aborted', 'task_complete', 'user_message'].includes(payload.type)) active = null;
  }
  return active;
}

function buildAnswerSteps(interaction, submission) {
  if (!interaction || interaction.type !== 'codex-question' || submission.callId !== interaction.callId) {
    throw new Error('This Codex question is no longer active. Refresh the panel and answer the current question.');
  }
  const supplied = Array.isArray(submission.answers) ? submission.answers : [];
  if (supplied.length !== interaction.questions.length) throw new Error('Answer every question before submitting.');
  const steps = [];
  interaction.questions.forEach((question, questionIndex) => {
    const answer = supplied[questionIndex] || {};
    if (String(answer.questionId || '') !== question.id) throw new Error('The Codex question changed. Refresh and try again.');
    const note = cleanText(answer.note);
    if (!question.options.length) {
      if (!note) throw new Error('Enter an answer before submitting.');
      steps.push({ type: 'paste', value: note }, { type: 'key', value: 'enter' });
      return;
    }
    const optionIndex = answer.optionIndex;
    const optionCount = question.options.length + (question.allowOther ? 1 : 0);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= optionCount) throw new Error('Select an option before submitting.');
    const isOther = optionIndex === question.options.length;
    if (!note && !isOther) {
      steps.push({ type: 'key', value: String(optionIndex + 1) });
      return;
    }
    steps.push({ type: 'key', value: 'delete' });
    for (let i = 0; i <= optionIndex; i += 1) steps.push({ type: 'key', value: 'down' });
    steps.push({ type: 'key', value: 'tab' });
    if (note) steps.push({ type: 'paste', value: note });
    steps.push({ type: 'key', value: 'enter' });
  });
  return steps;
}

module.exports = { activeQuestionFromJsonl, buildAnswerSteps };
