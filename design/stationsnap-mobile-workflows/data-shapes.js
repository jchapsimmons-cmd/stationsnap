/**
 * StationSnap — data shapes and prototype fixtures.
 *
 * This file is the seam between the design prototype and a real backend. Every export below is
 * currently a hard-coded fixture that the HTML prototype renders. Replace each one with a fetch
 * of the endpoint named in its @endpoint tag (see api-contract.md) and the screens keep working.
 *
 * Plain ES module, no dependencies. Typedefs are JSDoc so they survive a TS or a JS codebase.
 */

/** @typedef {'en'|'es'} Lang */
/** @typedef {Record<Lang, string>} Localized */

/**
 * @typedef {Object} Station
 * @property {string} id
 * @property {string} locationId
 * @property {string} name              e.g. "Grill Station"
 * @property {string} qrToken           encoded in the printed QR; stable across republishes
 * @property {string} qrUrl             public station page
 */

/**
 * @typedef {Object} Employee
 * @property {string} id
 * @property {string} name
 * @property {string} stationId
 * @property {string} pin               4 digits; signs completions, never a login credential
 */

/**
 * A single step of an SOP. `require` is what the employee must produce before advancing in
 * Guided/Demonstration mode — the server, not the client, decides whether it is satisfied.
 *
 * @typedef {Object} Step
 * @property {string} id
 * @property {Localized} text
 * @property {Localized} [warning]      renders the accent warning panel
 * @property {Localized} [meta]         small caption under the step
 * @property {string} [amount]          ingredient / material quantity, e.g. "4.0 oz"
 * @property {string} [equipment]       equipment setting, e.g. "Grill dial → OFF"
 * @property {number} [timerSeconds]    contact / hold time
 * @property {Localized} [timerLabel]
 * @property {string} [mediaId]         step photo or short clip
 * @property {'none'|'confirm'|'timer'|'photo'|'video'} require
 * @property {Localized} [confirmLabel] shown on the confirm checkbox
 */

/**
 * @typedef {Object} Procedure
 * @property {string} id
 * @property {string} stationId
 * @property {string} name
 * @property {number} version           bumped on publish; drives the 5b "SOP updated" screen
 * @property {string} publishedAt
 * @property {number} estimatedMinutes
 * @property {boolean} photoRequired
 * @property {Step[]} steps
 * @property {string} [referenceMediaId]  the approved-result photo
 * @property {string[]} materials
 */

/**
 * @typedef {Object} TranslationLine
 * @property {string} stepId
 * @property {string} source
 * @property {string} translated
 * @property {boolean} approved         publish is blocked until every line is approved
 */

/**
 * @typedef {Object} Assignment
 * @property {string} id
 * @property {string} procedureId
 * @property {{type:'employee'|'role'|'station'|'location'|'team', id:string}} target
 * @property {string} dueAt
 * @property {'once'|'every_close'|'weekly'} recurrence
 * @property {boolean} requirePhoto
 * @property {boolean} requireApproval
 */

/**
 * @typedef {Object} Completion
 * @property {string} id
 * @property {string} assignmentId
 * @property {string} employeeId
 * @property {string} stationId
 * @property {string} submittedAt
 * @property {'pending_signature'|'submitted'|'awaiting_approval'|'approved'|'correction_requested'} status
 * @property {string[]} photoIds
 * @property {{verdict:'match'|'differs'|'unknown', confidence:number}} [autoCheck]  assist only, never a gate
 * @property {{reasons:string[], note:string}} [correction]
 */

/**
 * Every knob on 4c. The client renders these; it does not decide them.
 *
 * @typedef {Object} TrainingSettings
 * @property {boolean} required
 * @property {boolean} inOrder            required steps cannot be skipped
 * @property {boolean} quizEnabled
 * @property {boolean} requireApproval    demonstration must be verified
 * @property {'employee'|'role'|'station'|'location'|'team'} assignBy
 * @property {number} passingScore        percent, e.g. 80
 * @property {number|null} attemptLimit   null = unlimited
 * @property {'never'|'90d'|'6mo'|'annual'} retrainInterval
 */

/**
 * @typedef {Object} TrainingPath
 * @property {string} id
 * @property {string} stationId
 * @property {string} name                e.g. "Grill Training"
 * @property {string[]} procedureIds      all must be complete to qualify
 */

/**
 * @typedef {Object} TrainingAssignment
 * @property {string} id
 * @property {string} employeeId
 * @property {string} procedureId
 * @property {string} procedureName
 * @property {Array<'learn'|'guided'|'test'|'demo'>} modes
 * @property {'assigned'|'in_progress'|'overdue'|'completed'|'updated'} state
 * @property {string} dueAt
 * @property {string} [progressLabel]
 */

/**
 * @typedef {Object} TrainingRun
 * @property {string} id
 * @property {string} trainingAssignmentId
 * @property {'learn'|'guided'|'test'|'demo'} mode
 * @property {string} currentStepId
 * @property {string[]} satisfiedStepIds
 * @property {number} attempt
 * @property {number|null} attemptsRemaining
 * @property {number} [lastScore]
 * @property {'in_progress'|'passed'|'failed'|'awaiting_verification'|'verified'} status
 */

/**
 * @typedef {Object} Qualification
 * @property {string} employeeId
 * @property {string} stationId
 * @property {string} pathId
 * @property {string} grantedAt
 * @property {string|null} retrainDueAt
 */

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {'correction'|'submitted'|'overdue'|'procedure_updated'|'training'} kind
 * @property {string} title
 * @property {string} body
 * @property {string} createdAt
 * @property {boolean} read
 */

// ---------------------------------------------------------------------------
// Fixtures — what the prototype renders today.
// ---------------------------------------------------------------------------

/** @type {Station} @endpoint GET /s/{stationToken} */
export const station = {
  id: 'st_grill', locationId: 'loc_riverside', name: 'Grill Station',
  qrToken: 'gr-riv-01', qrUrl: 'https://stat.sn/gr-riv-01'
};

/** @type {Employee[]} @endpoint GET /locations/{id}/employees */
export const employees = [
  { id: 'e_1', name: 'Marisol R.', stationId: 'st_grill', pin: '4182' },
  { id: 'e_2', name: 'Andre T.', stationId: 'st_fry', pin: '9037' },
  { id: 'e_3', name: 'Kev L.', stationId: 'st_prep', pin: '2265' }
];

/** @type {Procedure} @endpoint GET /procedures/{id} */
export const cleanTheGrill = {
  id: 'p_grill_clean', stationId: 'st_grill', name: 'Clean the grill',
  version: 4, publishedAt: '2026-08-01T00:00:00Z', estimatedMinutes: 12, photoRequired: true,
  referenceMediaId: null,
  materials: ['Grill brick', 'Degreaser (4 oz)', 'Blue towels', 'Sanitizer cloth', 'Heat gloves'],
  steps: [
    {
      id: 's1', require: 'confirm',
      text: { en: 'Power off. Wait until the surface reads under 300°F.',
              es: 'Apague. Espere a que la superficie baje de 300°F.' },
      warning: { en: 'Hot surface. Never scrape a live grill.',
                 es: 'Superficie caliente. Nunca raspe la plancha encendida.' },
      meta: { en: 'Before you start', es: 'Antes de empezar' },
      equipment: 'Grill dial → OFF',
      confirmLabel: { en: 'Grill is off and under 300°F', es: 'La plancha está apagada y bajo 300°F' }
    },
    {
      id: 's2', require: 'confirm',
      text: { en: 'Scrape the surface with the grill brick. Front to back.',
              es: 'Raspe la superficie con el ladrillo. De adelante hacia atrás.' },
      meta: { en: '~3 min', es: '~3 min' },
      equipment: 'Brick grade: medium',
      confirmLabel: { en: 'Surface scraped end to end', es: 'Superficie raspada de extremo a extremo' }
    },
    {
      id: 's3', require: 'timer', timerSeconds: 60,
      text: { en: 'Apply 4 oz degreaser. Spread even.',
              es: 'Aplique 4 oz de desengrasante. Extienda parejo.' },
      timerLabel: { en: 'Contact time', es: 'Tiempo de contacto' },
      meta: { en: '4 oz · 60 sec contact', es: '4 oz · 60 seg de contacto' },
      amount: '4.0 oz'
    },
    {
      id: 's4', require: 'confirm',
      text: { en: 'Wipe with a blue towel. Discard the towel.',
              es: 'Limpie con toalla azul. Deseche la toalla.' },
      meta: { en: 'One towel per pass', es: 'Una toalla por pasada' },
      confirmLabel: { en: 'Wiped and towel discarded', es: 'Limpiado y toalla desechada' }
    },
    {
      id: 's5', require: 'photo',
      text: { en: 'Wipe with the sanitizer cloth. Let it air dry.',
              es: 'Pase el paño sanitizante. Deje secar al aire.' },
      meta: { en: '~2 min', es: '~2 min' },
      equipment: 'Sanitizer 200 ppm'
    }
  ]
};

/** Closing checklist. @endpoint GET /stations/{id}/assignments?when=now */
export const closingChecklist = [
  { id: 'c1', label: { en: 'Clean the grill', es: 'Limpiar la plancha' }, station: 'Grill' },
  { id: 'c2', label: { en: 'Filter the fryers', es: 'Filtrar las freidoras' }, station: 'Fry' },
  { id: 'c3', label: { en: 'Empty all trash', es: 'Vaciar la basura' }, station: 'Floor' },
  { id: 'c4', label: { en: 'Restock stations', es: 'Reabastecer estaciones' }, station: 'All' },
  { id: 'c5', label: { en: 'Lock the coolers', es: 'Cerrar los enfriadores' }, station: 'Walk-in' },
  { id: 'c6', label: { en: 'Submit closing photos', es: 'Enviar fotos de cierre' }, station: 'Photo' }
];

/** Recipe build order. @endpoint GET /procedures/{id} (kind: recipe) */
export const smashBurger = {
  id: 'p_smash', name: 'Classic Smash Burger', specs: ['6.0 oz beef', '450°F', '90 sec'],
  build: [
    { name: { en: 'Bottom bun', es: 'Pan inferior' }, amount: 'toasted' },
    { name: { en: 'House sauce', es: 'Salsa de la casa' }, amount: '1 oz' },
    { name: { en: 'Pickles', es: 'Pepinillos' }, amount: '4 slices' },
    { name: { en: 'Smash patties', es: 'Carnes prensadas' }, amount: '2 × 3 oz' },
    { name: { en: 'American cheese', es: 'Queso americano' }, amount: '2 slices' },
    { name: { en: 'Grilled onions', es: 'Cebolla a la plancha' }, amount: '1 oz' },
    { name: { en: 'Top bun', es: 'Pan superior' }, amount: '—' }
  ],
  commonMistakes: { en: 'Smashing twice. Over-saucing. Cheese not melted.',
                    es: 'Prensar dos veces. Salsa de más. Queso sin derretir.' }
};

/**
 * Test questions. NOTE: `correct` is included here only so the prototype can score locally.
 * A real client must NOT receive it — post answers to /training-runs/{id}/test and let the
 * server score, count the attempt, and return pass/fail.
 * @endpoint POST /training-runs/{id}/test
 */
export const test = [
  { id: 'q1', q: 'What temperature must the grill be under before cleaning?', a: ['300°F', '450°F', 'Any temperature'], correct: 0 },
  { id: 'q2', q: 'How much degreaser does this SOP call for?', a: ['2 oz', '4 oz', '8 oz'], correct: 1 },
  { id: 'q3', q: 'Sanitizer concentration for the final wipe?', a: ['100 ppm', '200 ppm', '400 ppm'], correct: 1 },
  { id: 'q4', q: 'You may scrape the grill while it is still on.', a: ['True', 'False'], correct: 1 },
  { id: 'q5', q: 'Who reviews the completion photo?', a: ['Nobody', 'The manager', 'Another employee'], correct: 1 }
];

/** @type {TrainingSettings} @endpoint GET /procedures/{id}/training-settings */
export const trainingSettings = {
  required: true, inOrder: true, quizEnabled: true, requireApproval: true,
  assignBy: 'station', passingScore: 80, attemptLimit: 3, retrainInterval: '6mo'
};

/** @type {TrainingPath} @endpoint GET /stations/{id}/training-paths */
export const grillPath = {
  id: 'path_grill', stationId: 'st_grill', name: 'Grill Training',
  procedureIds: ['p_grill_clean', 'p_grill_temps', 'p_smash', 'p_grill_close']
};

/** @type {TrainingAssignment[]} @endpoint GET /employees/{id}/training */
export const myTraining = [
  { id: 'ta1', procedureId: 'p_grill_clean', procedureName: 'Clean the grill', modes: ['guided', 'test'], state: 'in_progress', dueAt: '2026-08-02T22:30:00Z', progressLabel: 'Step 3 of 5' },
  { id: 'ta2', procedureId: 'p_fry_filter', procedureName: 'Filter the fryer', modes: ['guided'], state: 'overdue', dueAt: '2026-08-01T22:30:00Z' },
  { id: 'ta3', procedureId: 'p_smash', procedureName: 'Classic Smash Burger', modes: ['demo'], state: 'assigned', dueAt: '2026-08-07T22:00:00Z' },
  { id: 'ta4', procedureId: 'p_sanitizer', procedureName: 'Sanitizer buckets', modes: ['learn'], state: 'updated', dueAt: '2026-08-05T22:00:00Z', progressLabel: 'v3 — 2 steps changed' },
  { id: 'ta5', procedureId: 'p_fc_open', procedureName: 'Open the front counter', modes: ['guided', 'test'], state: 'completed', dueAt: '2026-07-28T14:00:00Z', progressLabel: 'Passed 100%' }
];

/** Manager training dashboard rows. @endpoint GET /locations/{id}/training-dashboard */
export const trainingDashboard = [
  { employeeId: 'e_1', who: 'Marisol R.', path: 'Grill Training', percent: 75, status: '3 of 4 · demo pending' },
  { employeeId: 'e_2', who: 'Andre T.', path: 'Fry Training', percent: 100, status: 'Qualified · Jul 30' },
  { employeeId: 'e_3', who: 'Kev L.', path: 'Grill Training', percent: 25, status: 'Overdue 2 days' },
  { employeeId: 'e_4', who: 'Sam K.', path: 'Front Counter', percent: 50, status: 'Test failed 2 of 3 attempts' }
];

/** Completion history, day-grouped. @endpoint GET /locations/{id}/completions */
export const history = [
  { day: 'Today · Monday', rows: [
    { task: 'Clean the grill', who: 'Marisol R.', station: 'Grill', at: '10:14 PM', status: 'Approved' },
    { task: 'Fry station closed', who: 'Andre T.', station: 'Fry', at: '10:02 PM', status: 'Needs review' },
    { task: 'Closing checklist', who: 'Marisol R.', station: 'All', at: '9:58 PM', status: '6 of 6' },
    { task: 'Walk-in stocked', who: 'Kev L.', station: 'Walk-in', at: '8:20 PM', status: 'Approved' }
  ] },
  { day: 'Sunday', rows: [
    { task: 'Opening checklist', who: 'Dev O.', station: 'All', at: '6:04 AM', status: 'Approved' },
    { task: 'Clean the grill', who: 'Andre T.', station: 'Grill', at: '10:31 PM', status: 'Corrected' }
  ] }
];

/** @type {Notification[]} @endpoint GET /me/notifications */
export const notifications = [
  { id: 'n1', kind: 'correction', title: 'Correction requested', body: 'Dev O. asked Marisol R. to redo the grill clean.', createdAt: '2026-08-02T22:26:00Z', read: false },
  { id: 'n2', kind: 'submitted', title: 'Closing checklist submitted', body: 'Riverside · 6 of 6 · Marisol R.', createdAt: '2026-08-02T21:58:00Z', read: false },
  { id: 'n3', kind: 'overdue', title: 'Task overdue', body: 'Fryer filter · Fry station · due 9:30 PM', createdAt: '2026-08-02T21:31:00Z', read: false },
  { id: 'n4', kind: 'procedure_updated', title: 'Procedure updated', body: 'Clean the grill is now v4. QR unchanged.', createdAt: '2026-08-01T00:00:00Z', read: false }
];

/** Demonstration verification checks (5a). @endpoint POST /training-runs/{id}/verify */
export const demoChecks = [
  'Grill cooled before scraping',
  'Correct degreaser amount',
  'Full 60-second contact',
  'Sanitized and air dried'
];
