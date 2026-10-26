/**
 * Openers and closers: short interjections glued before / after a body line. They carry the same tags as bodies
 * (trait, time, weather...) plus a tone, so a curt line is never wrapped in a gushing greeting.
 */
import { buildFragments, g, type DlgGroup } from './types';

const OPENERS: DlgGroup[] = [
  // Neutral
  g({}, 'Ah.', 'Hm.', 'Well, now.', 'So.', 'Right.', 'Listen.', 'Mm.', 'Look here.', 'Heh.', 'Hear me out.'),
  // Tone
  g({ tone: 'warm' }, 'Welcome, welcome!', 'Ah, a friendly face!', 'Come, come.', 'Good to see you.', 'Heaven smiles on us today.', 'There you are!', 'Sit, sit.', 'Ah, {player}!'),
  g({ tone: 'curt' }, 'Speak.', 'Make it quick.', 'What now?', 'State your business.', 'Well?', 'Hurry up.', 'Yes? What is it?'),
  g({ tone: 'grim' }, 'Dark days.', 'Another day survived.', 'Heaven help us.', '*sighs*', 'Hard times, {player}.', 'Mind your step.', 'We live, for now.'),
  // Time of day
  g({ time: 'dawn' }, 'Early, aren\'t you?', 'Dawn already.', 'Up with the roosters, I see.'),
  g({ time: 'night' }, 'Late to be about.', 'Quiet night.', 'Lamplight and whispers, that\'s all the night is.'),
  g({ time: 'dusk' }, 'The light\'s going.', 'Evening already.', 'The lamps are being lit.'),
  // Weather
  g({ weather: 'rain' }, 'Wet enough for you?', 'Mind the mud.', 'Rain again.'),
  g({ weather: 'storm' }, 'Hear that thunder?', 'What a storm.', 'The sky is angry today.'),
  g({ weather: 'fog' }, 'Can\'t see my own hand in this fog.', 'Fog like milk today.'),
  g({ weather: 'snow' }, 'Cold enough to crack stone.', 'Snow again.', 'Frost on everything.'),
  g({ weather: 'clear' }, 'Fine day.', 'Clear skies, for once.'),
  g({ weather: 'cloudy' }, 'Grey sky today.', 'Clouds heavy as wet wool.'),
  // Seasons
  g({ season: 'spring' }, 'Spring at last.', 'Smell that? Thawed earth.'),
  g({ season: 'summer' }, 'Hot as a forge.', 'This heat, honestly.'),
  g({ season: 'autumn' }, 'Harvest weather.', 'Leaves are turning.'),
  g({ season: 'winter' }, 'Bitter season.', 'Winter\'s teeth are out.'),
  // Moods
  g({ mood: 'tired' }, '*yawns*', 'Forgive me, I\'m dead on my feet.'),
  g({ mood: 'hungry' }, 'Pardon my stomach.', 'Haven\'t eaten since yesterday, so bear with me.'),
  g({ mood: 'afraid' }, 'Quietly, now.', 'Keep your voice down.'),
  g({ mood: 'grieving' }, 'Forgive my red eyes.', 'We buried someone this week.'),
  // Traits
  g({ trait: 'superstitious' }, 'Knock on wood.', 'Spit three times first.', 'Touch the doorframe.'),
  g({ trait: 'devout' }, 'Heaven watch over you.', 'Peace be upon you.'),
  g({ trait: 'scholarly' }, 'As the classics say:', 'Curious.', 'Interesting timing.'),
  g({ trait: 'cunning' }, 'Between you and me.', 'Pst.', 'Come closer.'),
  g({ trait: 'greedy' }, 'Time is money, friend.', 'Let\'s not waste daylight.'),
  g({ trait: 'boastful' }, 'You know who I am, of course.', 'Ha! Fortune favours you today.'),
  g({ trait: 'honest' }, 'I\'ll be plain with you.', 'Truth be told.'),
  g({ trait: 'kind' }, 'Friend.', 'Dear traveller.'),
  g({ trait: 'cheerful' }, 'Oh, what a day!', 'Hah!'),
  g({ trait: 'weary' }, 'Sigh.', 'Where was I...'),
  g({ trait: 'stern' }, 'Attention.', 'Mark this.'),
  g({ trait: 'gruff' }, 'Hmph.', 'Bah.', 'Tch.'),
  // Situations
  g({ state: 'siege' }, 'Quickly, there is no time.', 'With the gates shut, time is short.'),
  g({ state: 'festival' }, 'Hah, the drums!', 'Lanterns everywhere today!'),
];

const CLOSERS: DlgGroup[] = [
  // Tone
  g({ tone: 'warm' }, 'Come by again.', 'Eat something warm before you go.', 'Walk safe, {player}.', 'The door is always open.', 'Don\'t be a stranger.', 'Heaven keep you.'),
  g({ tone: 'curt' }, 'Now move along.', 'That\'s all.', 'Don\'t dawdle.', 'Off with you.', 'Keep your hands where I can see them.', 'We\'re done.'),
  g({ tone: 'grim' }, 'Hold on to what you love.', 'Pray the walls hold.', 'We\'ll see another dawn, or we won\'t.', 'Keep your blade close.', 'Don\'t wander off the road.'),
  // Roles
  g({ role: 'guard' }, 'Mind the gate hours.', 'Report anything odd to the watch.'),
  g({ role: 'merchant' }, 'Tell your friends about my stall.', 'Come back when your purse is heavier.'),
  g({ role: 'innkeeper' }, 'There\'s a bed upstairs if you need it.', 'First cup is on me. Next, not.'),
  g({ role: 'smith' }, 'Bring me your blade if it chips.', 'Keep your steel oiled.'),
  g({ role: 'alchemist' }, 'Come by for a tonic.', 'Don\'t mix pills with wine.'),
  g({ role: 'master' }, 'Practice your forms.', 'Breathe from the belly, not the chest.'),
  g({ role: 'elder' }, 'Think on it.', 'Patience is the oldest remedy.'),
  g({ role: 'physician' }, 'Rest, and drink water.', 'Wash those hands.'),
  g({ role: 'wanderer' }, 'May our roads cross again.', 'The road takes and gives.'),
  g({ role: 'disciple' }, 'Go well. I must return to the yard.', 'May your forms be true.', 'The master is calling. Forgive me.'),
  g({ role: 'legend' }, 'Hm. Go on, then.', 'Don\'t make my mistakes.'),
  g({ role: 'villager' }, 'Mind the dogs on your way out.', 'Say hello to the neighbours.'),
  // Time & weather
  g({ time: 'night' }, 'Mind the dark roads.', 'Lock your door tonight.'),
  g({ time: 'dawn' }, 'Make good use of the morning.'),
  g({ time: 'dusk' }, 'Get indoors before dark.'),
  g({ weather: 'rain' }, 'Keep your feet dry.'),
  g({ weather: 'storm' }, 'Find shelter soon.'),
  g({ weather: 'snow' }, 'Wrap up warm.'),
  g({ weather: 'fog' }, 'Don\'t stray from the road in this.'),
  // Standing
  g({ standing: 'honoured' }, 'Our town owes you more than words.', 'You will always have a place here.'),
  g({ standing: 'despised' }, 'Don\'t linger.', 'Leave before I regret speaking.'),
  g({ standing: 'feared' }, 'I mean no offence, honoured guest.', 'Please, go gently.'),
  g({ standing: 'welcomed' }, 'You\'re always welcome here.'),
  // Traits
  g({ trait: 'superstitious' }, 'Touch the doorframe on your way out.', 'Don\'t look back once you\'ve left.'),
  g({ trait: 'devout' }, 'Say a prayer at the shrine.', 'The Buddha\'s mercy go with you.'),
  g({ trait: 'scholarly' }, 'Read when you can; it outlasts steel.', 'Write it down, or you will forget.'),
  g({ trait: 'greedy' }, 'And spend your coin wisely. Preferably here.', 'Remember, I do discounts for volume.'),
  g({ trait: 'cunning' }, 'Keep that between us.', 'Let\'s say this conversation never happened.'),
  g({ trait: 'boastful' }, 'Tell them {npc} sent you. They\'ll know the name.', 'Remember: you heard it from me first.'),
  g({ trait: 'honest' }, 'That\'s the plain truth of it.', 'I wouldn\'t lie to you.'),
  g({ trait: 'weary' }, 'Anyway. I have work.', 'Now if you\'ll excuse me, my feet are begging.'),
  g({ trait: 'cheerful' }, 'Smile! It\'s free.', 'Ha, off you go, and have fun!'),
  g({ trait: 'kind' }, 'Take care of yourself.', 'Let me know if you need anything.'),
  g({ trait: 'stern' }, 'Stand straight and walk true.', 'Do not disappoint me.'),
  g({ trait: 'gruff' }, 'Enough talk.', 'Go on, shoo.'),
  // Situations
  g({ state: 'siege' }, 'Stay off the walls unless you can fight.'),
  g({ state: 'famine' }, 'If you have bread to spare, say so.'),
  g({ state: 'festival' }, 'Join the dancing if you can.'),
  g({ state: 'plague' }, 'Keep your face covered.'),
];

export const OPEN_FRAGMENTS = buildFragments('any', 'open', 'o', OPENERS);
export const CLOSE_FRAGMENTS = buildFragments('any', 'close', 'c', CLOSERS);
