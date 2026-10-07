import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCopy, checkMedia, findPlaceholders } from '../server/social/rules.js'

const rulesHit = (post, options) => checkCopy(post, options).blocks.map((block) => block.rule)

test('productivity and attention-minutes claims are blocked', () => {
  assert.deepEqual(rulesHit({ headline: 'Boost team productivity with dance' }), ['productivity'])
  assert.deepEqual(rulesHit({ caption: 'A session that will improve focus at work.' }), ['productivity'])
  assert.deepEqual(rulesHit({ caption: 'Attention drops after 10 minutes, so we keep moving.' }), ['attention_minutes'])
  assert.deepEqual(rulesHit({ caption: 'After 20 mins most people lose concentration.' }), ['attention_minutes'])
  assert.deepEqual(rulesHit({ caption: 'A 45 minute workshop for the whole year group.' }), [])
})

test('weight, calorie and health outcome claims are blocked', () => {
  assert.deepEqual(rulesHit({ subhead: 'Burn 500 calories a class' }), ['weight_health'])
  assert.deepEqual(rulesHit({ caption: 'The fun way to lose weight' }), ['weight_health'])
  assert.deepEqual(rulesHit({ caption: 'Helps lower blood pressure' }), ['weight_health'])
  assert.deepEqual(rulesHit({ caption: 'A high energy workout for all levels. Come and sweat with us!' }), [])
})

test('research is allowed only through an approved statement, word for word', () => {
  const researchStatements = ['Approved statement about dance and wellbeing.']
  assert.deepEqual(rulesHit({ caption: 'Studies show dance makes you smarter.' }, { researchStatements }), ['research'])
  assert.deepEqual(rulesHit({ caption: 'Approved statement about dance and wellbeing. Join us!' }, { researchStatements }), [])
  assert.deepEqual(rulesHit({ caption: 'Research says it works.' }), ['research'])
  assert.deepEqual(rulesHit({ caption: '20% off your first month' }), [])
})

test("children's first names are flagged, staff names and lower-case words are not", () => {
  const options = { childNames: ['Grace', 'Tobi', 'Steven'], allowNames: ['Steven'] }
  assert.deepEqual(checkCopy({ caption: 'Well done Tobi on your first show!' }, options).nameMatches, ['Tobi'])
  assert.deepEqual(checkCopy({ caption: 'Saved by grace. Class with Steven.' }, options).nameMatches, [])
  assert.deepEqual(checkCopy({ slides: [{ heading: 'Grace leads the line', body: '' }] }, options).nameMatches, ['Grace'])
})

test('placeholders are found', () => {
  assert.equal(findPlaceholders({ caption: 'Book at [LINK]' }).length, 1)
  assert.equal(findPlaceholders({ headline: 'QR CODE HERE' }).length, 1)
  assert.equal(findPlaceholders({ headline: 'Doors at {{time}}' }).length, 1)
  assert.equal(findPlaceholders({ headline: "It's Time to Rise" }).length, 0)
})

test('uncleared media and children on corporate posts are refused', () => {
  const media = new Map([
    ['kid', { id: 'kid', kind: 'image', consent: 'cleared', shows_children: true, title: 'Kids class' }],
    ['adult', { id: 'adult', kind: 'image', consent: 'adults_only', shows_children: false, title: 'Team' }],
    ['no', { id: 'no', kind: 'image', consent: 'not_cleared', shows_children: false, title: 'Pending' }],
  ])
  assert.deepEqual(checkMedia({ template: 'poster', platforms: ['instagram'], media_id: 'kid' }, media), [])
  assert.deepEqual(checkMedia({ template: 'poster', platforms: ['instagram'], media_id: 'no' }, media).map((item) => item.rule), ['uncleared'])
  assert.deepEqual(checkMedia({ template: 'linkedin_card', platforms: ['linkedin'], media_id: 'kid' }, media).map((item) => item.rule), ['children_corporate'])
  assert.deepEqual(checkMedia({ template: 'poster', platforms: ['instagram', 'linkedin'], media_id: 'kid' }, media).map((item) => item.rule), ['children_corporate'])
  assert.deepEqual(checkMedia({ content_type: 'corporate_team', template: 'linkedin_card', platforms: ['linkedin'], media_id: 'adult' }, media), [])
  assert.deepEqual(checkMedia({ template: 'carousel', platforms: ['instagram'], slides: [{ heading: 'a', mediaId: 'no' }] }, media).map((item) => item.rule), ['uncleared'])
})
