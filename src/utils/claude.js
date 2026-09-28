const BATCH_SIZE = 5;

async function callClaude(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Anthropic API error');
  }
  const data = await res.json();
  return data.content[0].text;
}

function parseJsonResponse(text) {
  try { return JSON.parse(text); } catch {
    const arr = text.match(/\[[\s\S]*\]/);
    if (arr) return JSON.parse(arr[0]);
    const obj = text.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]);
    throw new Error('Could not parse Claude response as JSON');
  }
}

function buildEmailTemplate(s, sender) {
  return `Subject: Reminder ${s.reminderNumber} — ${s.term} ${s.feeType} Fee | ${s.studentName} | The Heritage School

Dear Parent,

Greetings from The Heritage School.

This is Reminder ${s.reminderNumber} for the outstanding ${s.term} ${s.feeType} fee.

We wish to bring to your kind attention that the ${s.term} ${s.feeType} fee of ₹${s.amountDue} is currently outstanding for your child ${s.studentName}, Class ${s.batchName}. The last date for payment was ${s.dueDate}.

We kindly request you to clear the outstanding amount at your earliest convenience. We truly appreciate your continued support and trust in the School.

Should you have any concerns regarding the payment or require any assistance, please do not hesitate to reach out to us at the school office. We are happy to help.

If the payment has already been processed, we sincerely apologise for this reminder and request you to disregard this message.

With warm regards,
${sender}`
}

function buildWhatsAppTemplate(s, sender) {
  return `Dear Parent,\n\nThis is Reminder ${s.reminderNumber} for the ${s.term} ${s.feeType} fee of ₹${s.amountDue} for ${s.studentName}, Class ${s.batchName}. The last date for payment was ${s.dueDate}.\n\nIf you have already made the payment, kindly ignore this message and accept our apologies for the inconvenience.\n\nPlease feel free to contact us if you need any assistance.\n\n- ${sender}`
}

export function draftFeeReminders(students, sender, onProgress) {
  return students.map((s, i) => {
    onProgress?.(i + 1, students.length)
    return {
      email: normaliseSpacing(buildEmailTemplate(s, sender)),
      whatsapp: normaliseSpacing(buildWhatsAppTemplate(s, sender)),
    }
  })
}

function buildTransportEmailTemplate(s, sender) {
  const greeting = s.fathersName ? `Dear ${s.fathersName},` : 'Dear Parent,'
  return `Subject: Reminder ${s.reminderNumber} — Term ${s.term} Transport Fee | ${s.studentName} | The Heritage School

${greeting}

Greetings from The Heritage School.

This is a reminder that the Term ${s.term} transport fee of ₹${s.amountDue} for ${s.studentName}, Class ${s.standard} is currently outstanding.

We kindly request you to clear the outstanding amount at your earliest convenience. We truly appreciate your continued support and trust in the School.

Should you have any concerns regarding the payment or require any assistance, please do not hesitate to reach out to us at the school office. We are happy to help.

If the payment has already been processed, we sincerely apologise for this reminder and request you to disregard this message.

With warm regards,
${sender}`
}

function buildTransportWhatsAppTemplate(s, sender) {
  const greeting = s.fathersName ? `Dear ${s.fathersName},` : 'Dear Parent,'
  return `${greeting}\n\nThis is a reminder that the Term ${s.term} transport fee of ₹${s.amountDue} for ${s.studentName}, Class ${s.standard} is currently outstanding.\n\nIf you have already made the payment, kindly ignore this message and accept our apologies for the inconvenience.\n\nPlease feel free to contact us if you need any assistance.\n\n- ${sender}`
}

export function draftTransportReminders(students, sender, onProgress) {
  return students.map((s, i) => {
    onProgress?.(i + 1, students.length)
    return {
      email: normaliseSpacing(buildTransportEmailTemplate(s, sender)),
      whatsapp: normaliseSpacing(buildTransportWhatsAppTemplate(s, sender)),
    }
  })
}

export async function translateTemplateToMalayalam(template, apiKey) {
  const prompt = `You are the communication secretary of The Heritage School, Aluva. Rewrite the following school communication in warm, professional Malayalam suitable for Kerala school parent communication.

Template type: ${template.title}
Original English Subject: ${template.subject}
Original English Body:
${template.body}

Rules:
- Preserve every placeholder in [square brackets] exactly as written, in English. Do NOT translate the text inside square brackets (e.g. keep [Date], [Time], [Festival Name] as-is).
- Keep the paragraph structure and line breaks of the original.
- Tone: respectful, gentle, parent-appropriate. Avoid archaic or overly formal Malayalam.
- Do NOT add "Dear Parent" or any salutation at the start — the greeting is added separately by the app.
- End the body with a sign-off on two lines: "സ്നേഹത്തോടെ," on its own line, then "The Heritage School | Administration" on the next.
- Plain text only — no markdown, no asterisks.

Return ONLY a JSON object with two keys:
- "subject": the Malayalam subject line, no "Subject:" prefix
- "body": the Malayalam body

Return ONLY the JSON object, no explanation.`

  const text = await callClaude(prompt, apiKey)
  return parseJsonResponse(text)
}

export async function generateLetter({ commType, tone, format, keyPoints, language }, apiKey) {
  const formatInstructions = {
    'WhatsApp':        'Short and conversational — 3 to 4 sentences maximum. No salutation, no sign-off. Plain text only, no bullet points.',
    'Standard Letter': 'Professional school letter — 2 to 3 paragraphs. Include a warm opening, the key information, and a polite closing.',
    'Detailed Letter': 'Comprehensive formal letter — 4 to 5 paragraphs. Full context, elaborated points, formal tone throughout.',
  }

  const prompt = `You are the communication secretary of The Heritage School, Aluva. Write a school communication in ${language}.

Communication type: ${commType}
Tone: ${tone}
Format: ${format} — ${formatInstructions[format]}
Key points to cover: ${keyPoints}
Sender: The Heritage School, Aluva

Return ONLY a JSON object with two keys:
- "subject": a concise subject line (no "Subject:" prefix)
- "body": the letter body only — no subject line, no markdown, no asterisks, plain text

Formatting rules for the body:
- Do NOT include "Dear Parent" or any salutation — that is added separately
- Separate every paragraph with a single blank line
- The very last thing in the body must be a blank line followed by the sign-off on two lines exactly like this:

Warm regards,
The Heritage School Administration

Write entirely in ${language}.
Return ONLY the JSON object, no explanation.`

  const text = await callClaude(prompt, apiKey)
  return parseJsonResponse(text)
}

const GREETINGS = {
  English:   { email: name => `Dear Parent of ${name},`, whatsapp: () => 'Dear Parent,' },
  Malayalam: { email: ()   => 'പ്രിയ രക്ഷിതാവേ,',      whatsapp: () => 'പ്രിയ രക്ഷിതാവേ,' },
}

function normaliseSpacing(text) {
  // Exactly one blank line after greeting (English or Malayalam)
  text = text.replace(/^(Dear Parent[^,\n]*,|പ്രിയ രക്ഷിതാവേ,)\n+/, '$1\n\n')
  // Exactly one blank line before sign-off (English or Malayalam)
  text = text.replace(/\n+((?:With\s+)?[Ww]arm regards,|സ്നേഹത്തോടെ,)/g, '\n\n$1')
  text = text.replace(/\n+(-\s)/g, '\n\n$1')
  return text.trim()
}

export function draftBroadcasts(students, subject, body, sender, language = 'English', onProgress) {
  const g = GREETINGS[language] ?? GREETINGS.English
  const finalBody = (body || '').replace('The Heritage School Administration', sender)
  const hasMarker = finalBody.includes('{{GREETING}}')
  const results = students.map((s, i) => {
    const name = s['Student Name'] || `${s['First Name'] || ''} ${s['Last Name'] || ''}`.trim()
    const email = normaliseSpacing(hasMarker
      ? finalBody.replace('{{GREETING}}', g.email(name))
      : `${g.email(name)}\n\n${finalBody}`)
    const whatsapp = normaliseSpacing(hasMarker
      ? finalBody.replace('{{GREETING}}', g.whatsapp())
      : `${g.whatsapp()}\n\n${finalBody}`)
    onProgress?.(i + 1, students.length)
    return { email, whatsapp }
  })
  return results
}
