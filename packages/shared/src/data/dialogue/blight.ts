/** "About the Blight": dread, lore and folk wisdom in every voice. */
import { buildFragments, g, type DlgGroup } from './types';

const BLIGHT: DlgGroup[] = [
  g({}, 'The Blight is not weather and not war. It is something worse, a patient hunger.', 'Where it spreads, the ground goes grey and the animals go wrong.', 'They say Hearts beat beneath the ruins. I say they beat in the dreams of everyone who lives near them.', 'Hollows were people once. Do not forget that when you swing.', 'It started in the old ruins and has not stopped since. Nobody really knows why.', 'You can smell it before you see it: wet iron and old smoke.'),
  // Roles
  g({ role: 'guard' }, 'I have seen Hollows at the wall. They do not scream. They just keep coming.', 'Rule one: never fight a Hollow alone. Rule two: see rule one.', 'Burn them, bury them, whatever you do, do not let them touch the wounded.'),
  g({ role: 'alchemist' }, 'I have studied the rot. It is not poison, not exactly. It rewrites the body\'s own instructions.', 'Salt, ash and bitter-root slow it. Nothing stops it. I keep looking.'),
  g({ role: 'physician' }, 'Blight sickness shows as grey veins at the wrist. Show me the first sign and I may save you.', 'I have seen it creep up a man\'s arm over three days. He asked me to take the arm. I would have.'),
  g({ role: 'master' }, 'Purifying arts push it back. Strong qi stays clean. Weak qi, well, it does not.', 'Every form I teach has one purpose now: to survive the next Hollow. The rest is decoration.'),
  g({ role: 'elder' }, 'My grandfather said the first Heart was a falling star. My grandmother said it was a curse. I say it is both.', 'We have lost eleven good people to it in my time. I recite their names each season.'),
  g({ role: 'villager' }, 'The fields at the edge are grey now. We do not go there after dark.', 'My cousin\'s farm is gone. The Blight just walked over it, slowly, like a tide.'),
  g({ role: 'innkeeper' }, 'Guests tell me the mist reaches the road some nights. They do not stay long.', 'Travellers who come through from the grey country do not talk much. They drink, though.'),
  g({ role: 'merchant' }, 'The roads close when the mist rises. Prices rise with it. Funny how that works.', 'Every stretch of road the Blight takes is a stretch of trade I lose.'),
  g({ role: 'smith' }, 'Iron holds off the rot. Sword, pot, nail. That is why I am busy.', 'I have forged cold-iron nails for a hundred doors. Folk say they keep the Blight out.'),
  g({ role: 'legend' }, 'I saw the first Heart wake. I will not describe it. Be glad you did not.', 'Fire, steel, spirit. I have used them all against it. Spirit, in the end, matters most.'),
  g({ role: 'wanderer' }, 'I have seen towns taken whole by it. Nothing left but silence and grey weeds.', 'The grey country is quiet. Not peaceful. Quiet, like a held breath.'),
  // Traits
  g({ trait: 'superstitious' }, 'Do not speak of it after dark. It listens.', 'Hang iron at the door and salt at the sill. It will not stop it, but it makes me feel better.'),
  g({ trait: 'devout' }, 'The Blight is a test. The shrine gives me strength.', 'Prayer does not push it back, but it keeps despair at bay, and that matters.'),
  g({ trait: 'scholarly' }, 'The records suggest a cyclical emergence, each worse than the last.', 'I have compiled eleven theories of its origin. Ten are wrong, and I do not know which.'),
  g({ trait: 'cheerful' }, 'We will beat it. We always have. ... Haven\'t we?', 'Look at it this way: every year without it is a good year. And some of them are quite good!'),
  g({ trait: 'stern' }, 'Duty is the answer: stand, fight, endure.', 'Panic does more harm than the Blight. Keep your head.'),
  g({ trait: 'weary' }, 'It never ends. Kill one wave and another comes.', 'Sometimes I wonder what we are protecting, when everything is grey at the edges.'),
  g({ trait: 'kind' }, 'I feel for the Hollows. They were someone\'s child.', 'It breaks my heart. And I have a lot of heart to spare.'),
  g({ trait: 'greedy' }, 'Bad for trade. Worse for me personally.', 'Everything it touches loses value. That, I take personally.'),
  g({ trait: 'boastful' }, 'I would take on a dozen Hollows. Ask anyone. Well, ask someone who was there.', 'I faced the grey mist once and it blinked first. Ask no further.'),
  g({ trait: 'cunning' }, 'Some profit from it. I know who. I will not say.', 'There are those who feed the Blight for their own purposes. Think about that.'),
  g({ trait: 'honest' }, 'I am afraid, and I will say so plainly.', 'I do not know how to beat it. I know how to keep going. That is enough, most days.'),
  g({ trait: 'gruff' }, 'Kill them, burn the rest. Less talking.', 'Blight, Hollows, whatever. Swing harder.'),
  // States
  g({ state: 'blighted' }, 'It is close, {player}. Closer than it has been in my lifetime.', 'Our wells turn bitter, our crops wither at the edges. We are at the fringe of it now.', 'Another season like this and we will be at the Blight\'s mercy.'),
  g({ state: 'siege' }, 'The Hollows are at the gate right now. How is that for an answer?', 'You are asking this while they hammer on the walls?'),
  g({ state: 'calm' }, 'Here, thank the walls, it keeps its distance. For now.', 'We have been lucky. I make offerings to the luck, in case it is listening.'),
  g({ state: 'fallen' }, 'It took us. All that remains is ash.', 'I watched it swallow the market. I will not forget the sound.'),
  g({ state: 'plague' }, 'Some say the fever is the Blight in another coat. I do not know, and I do not wish to.'),
  g({ state: 'famine' }, 'Hunger and Blight feed each other. One thins the harvest, the other thins the town.'),
  // Weather & season
  g({ weather: 'fog' }, 'Fog and Blight-mist look alike. Know the difference or die.', 'Do not trust a fog near the grey fields. It sometimes breathes.'),
  g({ weather: 'rain' }, 'Rain thins the Blight. A gift from heaven, small as it is.'),
  g({ weather: 'storm' }, 'Storms push it back for a day or two. Then it creeps again.'),
  g({ weather: 'clear' }, 'On clear days you can see the grey line on the horizon. It moves, if you watch long enough.'),
  g({ season: 'winter' }, 'The cold slows it. Winter is our breath of relief.'),
  g({ season: 'summer' }, 'It grows fastest in summer. Heat and rot go together.'),
  g({ time: 'night' }, 'Night is when it feels closest. Do not wander out alone.'),
  // Deeds colour
  g({ deed: ['killedHollows', 'sealedHeart', 'purified', 'savedTown'] }, 'You have faced it yourself, {player}. You know what I am talking about. You {deed}.'),
  g({ standing: 'honoured' }, 'You have pushed it back more than the rest of us put together, {player}. Thank you.'),
  g({ role: 'guard', state: 'blighted' }, 'We have doubled the night watch. The Hollows grow bolder with the dark.'),
  g({ role: 'elder', state: 'blighted' }, 'I have asked the council to prepare a shelter in the hills. Nobody wants to hear it yet.'),
  g({ role: 'villager', state: 'blighted' }, 'My eldest has a grey patch on her palm. I tell myself it is soot.'),
  g({ role: 'master', trait: 'stern' }, 'Train harder. The Blight does not wait for you to feel ready.'),
  g({ role: 'alchemist', trait: 'scholarly' }, 'The spores react to hot salt and cold iron. I am writing it all down in case I do not finish.'),
  g({ role: 'physician', trait: 'kind' }, 'I do not turn away the grey-veined. Many would. I cannot.'),
];

export const BLIGHT_FRAGMENTS = buildFragments('blight', 'body', 'b', BLIGHT);
