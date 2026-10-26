/** "About your work": each role talks shop in its own voice. */
import { buildFragments, g, type DlgGroup } from './types';

const WORK: DlgGroup[] = [
  g({ role: 'guard' }, 'Walls, gates, patrols. Three things, repeat daily until you die.', 'Watch, wait, and hope nothing happens. Nothing is the best day.', 'I check the gate at dawn and dusk, walk the wall at midday, and doze on a good day.', 'Keeping thieves out and the Hollows farther. That is the job.', 'Pay is poor. Pride is good.', 'Every guard prays for a boring shift. Mine has been boring for a week, and I am still nervous.', 'I once chased a goat for an hour thinking it was a bandit. Don\'t repeat that.'),
  g({ role: 'merchant' }, 'Buy low, sell high, never trust a man who says "honestly".', 'The roads are my enemies and my livelihood.', 'Margins are thin. Honesty is thinner.', 'I move grain, cloth, iron. Anything that keeps a town fed or armed.', 'Caravans bring goods, goods bring coin. When caravans stop, I worry.', 'I count coins for a living. It is less glamorous than it sounds.', '{trade} is the backbone of my stall. Everything else is garnish.'),
  g({ role: 'smith' }, 'Heat, hammer, quench. Repeat until your arms fall off.', 'A sword is only as good as the arm. And the iron. Mostly the iron.', 'Every blade I make is a promise. I do not break promises.', 'Ore is getting scarcer. We make do with scrap.', 'Horseshoes, plow-blades, and the odd sword. Honest work.', 'The forge never cools. Neither do my worries.'),
  g({ role: 'alchemist' }, 'I boil roots and read fevers. Not glamorous.', 'Every pill is an experiment someone survived.', 'Herbs are harder to find with the Blight about.', 'Medicines, poultices, the occasional curse remover. Do not ask.', 'My craft is patience: wait, watch, measure. Rush it and you are burying a patient.', 'A drop too much and it is poison. A drop too little and it is water. That is all of alchemy.'),
  g({ role: 'innkeeper' }, 'I fill mugs and listen. People pay for the first and tell me for free about the second.', 'Beds, broth, and discretion: my three trades.', 'Business is steady. Fear makes people drink.', 'I keep the fire lit and the doors barred. Guests like both.', 'I make up the rooms, count the till, and keep everyone\'s secrets. Mostly.', 'The work is constant. Mugs do not wash themselves.'),
  g({ role: 'master' }, 'I teach forms, breath, and restraint. The last is hardest.', 'Every student arrives thinking they are ready. None are.', 'Teaching is a long way of repeating myself until it sticks.', 'The sword teaches humility if you let it.', 'My duty is to pass on what was handed to me, unbroken.', 'I train the body to serve the mind, the mind to serve the heart.'),
  g({ role: 'elder' }, 'I settle disputes, keep the records, and remember who is owed what.', 'An elder\'s job is to be right slowly, so the village does not have to be wrong quickly.', 'Tax-collectors, land disputes, funerals. I am the one they ask.', 'I advise. Whether they listen is another matter.', 'Mostly I listen. People just want to be heard.', 'I am the keeper of memory for {settlement}. It is heavier than it sounds.'),
  g({ role: 'physician' }, 'I set bones, lance boils, and pronounce the unlucky dead.', 'Prevention is better than cure. Nobody listens until it is too late.', 'A good physician spends more time talking than cutting.', 'The Blight brought me more work than I wanted, and poorer patients.', 'I treat anyone who comes. Gold or no gold.', 'Most healing is waiting. The body does the work. I just keep out of the way.'),
  g({ role: 'legend' }, 'I used to fight for glory. Now I fight to be left alone.', 'My work? Surviving, mostly. And sometimes teaching idiots like you.', 'There is no work left for a name like mine. Only duty.', 'I stand where I am needed, not where I am wanted.', 'What is left of a legend\'s work, you ask? Regret, mostly.', 'Wandering, watching, occasionally intervening. Much like the weather.'),
  g({ role: 'wanderer' }, 'I carry messages, sell oddments, and take what coin I can find.', 'The road is the work.', 'Sometimes I guide folk. Sometimes I rob them. ... Joking.', 'Today, I am resting. Tomorrow, who knows.', 'I haul stories more than goods. Stories sell better.', 'Work finds me. Usually at inopportune moments.'),
  g({ role: 'villager' }, 'Fields, hearth, children, repeat.', 'I till the soil, mend the roof, feed the goats. The usual.', 'Work from sun to moon, and still the barn leaks.', 'We farm what the Blight leaves us.', 'I help my neighbours and they help me. That is how we survive.', 'Some of us weave, some mend nets, some dig. All of us worry.'),
  // Traits
  g({ trait: 'greedy' }, 'Work is only worth doing if it pays. Ask me what I charge.', 'I am not in it for love, {player}. I am in it for gold.'),
  g({ trait: 'kind' }, 'I do the work because someone must. And people need it.', 'It is not much, but it helps. That is enough for me.'),
  g({ trait: 'weary' }, 'It is endless. But what else is there to do?', 'Work, sleep, work. I remember when it was a pleasure.'),
  g({ trait: 'devout' }, 'Work is prayer in motion.', 'I begin each day at the shrine, and end it there. The work in between is the offering.'),
  g({ trait: 'cunning' }, 'Work smart, not hard. That is my motto.', 'The trick to any trade is knowing which parts to do properly and which to merely appear to.'),
  g({ trait: 'honest' }, 'I do an honest day\'s work for an honest day\'s pay.', 'No tricks to it. Just effort.'),
  g({ trait: 'gruff' }, 'Work is work. Stop asking.', 'Hard. Next question.'),
  g({ trait: 'cheerful' }, 'I love my work! Most days. Today in particular!', 'Every day I get to do something useful. That is a gift!'),
  g({ trait: 'stern' }, 'Duty is duty. It needs doing and I do it.', 'There is no such thing as a small task, only a task done well or badly.'),
  g({ trait: 'boastful' }, 'I am the best at what I do. Ask around.', 'Other people work. I perform.'),
  g({ trait: 'superstitious' }, 'I never start work without a charm. Do not laugh.', 'Never begin on the fourth day of the month. I lost a finger once, doing that.'),
  g({ trait: 'scholarly' }, 'In my work I have compiled notes, four volumes so far.', 'Every task deserves a method, and every method deserves a manual.'),
  // Situations
  g({ state: 'siege' }, 'Work? There is only one job now: hold the walls.', 'Everything I do now is for the siege. Everything else can wait.'),
  g({ state: 'famine' }, 'Work is hard on an empty stomach, {player}. I do what I can.', 'Half-rations, full shifts. That is the work now.'),
  g({ state: 'festival' }, 'Even I take a bit of time off during a festival. A bit.'),
  g({ state: 'plague' }, 'Work is mostly keeping everyone apart now. Lonely business.'),
  g({ state: 'prosperous' }, 'More work than hands, which is the best problem a person can have.'),
  g({ time: 'night' }, 'Work does not stop at night. It just gets quieter.'),
  g({ time: 'dawn' }, 'Early start. Always. The day is shorter than the list.'),
  g({ weather: 'rain' }, 'Rain slows everything, but the work does not care.'),
  g({ weather: 'snow' }, 'Snow or not, the work waits for no one.'),
  // Combinations
  g({ role: 'guard', trait: 'gruff' }, 'I stand on the wall. Things come. I hit them. That is the job.'),
  g({ role: 'merchant', trait: 'greedy' }, 'Every sale is a small victory. I keep a tally on the wall.'),
  g({ role: 'smith', trait: 'cheerful' }, 'Sparks, soot, steel: what more could a person want? I love it!'),
  g({ role: 'innkeeper', trait: 'cheerful' }, 'I get paid to chat and pour. If that is not the best job, I do not know what is.'),
  g({ role: 'master', trait: 'kind' }, 'I teach because I remember what it was like to have nobody to teach me.'),
  g({ role: 'physician', trait: 'weary' }, 'Another night of fevers. I stopped counting in the second hour.'),
  g({ role: 'elder', trait: 'scholarly' }, 'I am recording the history of {settlement} line by line. By the time I finish, there will be more to add.'),
  g({ role: 'villager', trait: 'weary' }, 'I rise before the roosters and drop before the stars. Why do you ask?'),
  g({ role: 'wanderer', trait: 'cunning' }, 'I find what other people lose and return it, for a fee.'),
];

export const WORK_FRAGMENTS = buildFragments('work', 'body', 'w', WORK);
