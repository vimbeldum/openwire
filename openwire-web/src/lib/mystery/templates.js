/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: Templates
   Bounded Context: MurderMystery
   5 handcrafted mystery templates with rich suspects,
   cross-clues, and guaranteed solvability.
   ═══════════════════════════════════════════════════════════ */

const TEMPLATES = [

    /* ── 1. The Vanishing at Vineyard Manor ────────────────── */
    {
        id: 'vineyard_manor',
        title: 'The Vanishing at Vineyard Manor',
        setting: 'A sprawling estate in the French countryside during a lavish dinner party. Rain hammers the windows. The power has flickered twice already.',
        victim: {
            name: 'Lord Ashworth',
            role: 'the host of the dinner party',
            description: 'A wealthy vineyard owner found slumped over his desk in the locked study, a shattered wine glass at his feet.',
        },
        weapon: 'poisoned wine glass laced with aconite',
        motive: 'Lord Ashworth discovered the culprit had been embezzling from the vineyard for years and planned to expose them at dinner.',
        culpritIndex: 2,
        suspects: [
            {
                name: 'Chef Renard',
                role: 'the victim\'s personal chef',
                avatar: '👨‍🍳',
                personality: 'Passionate, temperamental, fiercely proud of his cooking. Quick to anger but equally quick to laugh.',
                backstory: 'Has served the Ashworth family for 12 years. Recently received a harsh review from Lord Ashworth about his declining menu quality.',
                alibi: 'I was in the kitchen preparing the fourth course when the lights went out. My sous chef can confirm.',
                secret: 'He has been stealing vintage wines from the cellar and selling them to a rival estate.',
                relationshipToVictim: 'Employee and reluctant confidant. Lord Ashworth often ate in the kitchen and shared gossip.',
                secretConstraints: ['Never directly admit to stealing wines from the cellar', 'Never reveal the name of the rival estate you sell to', 'If asked about the wine cellar, redirect to your cooking'],
            },
            {
                name: 'Lady Margaux',
                role: 'the victim\'s estranged wife',
                avatar: '👩‍🦰',
                personality: 'Elegant, composed, icily polite. Rarely shows emotion but her eyes miss nothing.',
                backstory: 'Separated from Lord Ashworth for two years but never divorced. She arrived uninvited to tonight\'s dinner.',
                alibi: 'I was in the drawing room speaking with Baroness Leclerc when we heard the crash from the study.',
                secret: 'She has been secretly funding her lover\'s art gallery with money skimmed from the household accounts.',
                relationshipToVictim: 'Estranged spouse. They were negotiating a bitter divorce settlement worth millions.',
                secretConstraints: ['Never reveal you have a lover or the art gallery', 'Never admit to skimming household accounts', 'If asked about the divorce, say it was amicable'],
            },
            {
                name: 'Steward Dubois',
                role: 'the estate\'s head steward',
                avatar: '🤵',
                personality: 'Meticulous, reserved, deeply loyal to the estate above any individual. Speaks in measured, formal tones.',
                backstory: 'Has managed Vineyard Manor for 20 years. Knows every secret passage, every locked drawer, every skeleton in every closet.',
                alibi: 'I was conducting my evening rounds, checking that all doors were secured against the storm.',
                secret: 'He has been embezzling estate funds for years to pay for his daughter\'s medical treatments abroad. Lord Ashworth found the discrepancies yesterday.',
                relationshipToVictim: 'Trusted servant who knew the victim\'s darkest secrets. Lord Ashworth threatened to fire him and press charges.',
                secretConstraints: ['Never admit to embezzlement or financial irregularities', 'Never mention your daughter\'s illness as a motive', 'If confronted with evidence, deflect to your decades of loyal service', 'Never reveal that Lord Ashworth threatened you yesterday'],
            },
            {
                name: 'Baroness Leclerc',
                role: 'a neighbouring aristocrat and family friend',
                avatar: '👸',
                personality: 'Charming, gossipy, socially ambitious. Uses laughter to disarm and information as currency.',
                backstory: 'Old university friend of Lord Ashworth. Her own estate is heavily mortgaged and she has been lobbying Ashworth for a loan.',
                alibi: 'I was with Lady Margaux in the drawing room. We were discussing the ghastly weather and upcoming charity gala.',
                secret: 'She is bankrupt and was planning to blackmail Lord Ashworth over his wife\'s affair to secure the loan.',
                relationshipToVictim: 'Old friend turned desperate opportunist. Ashworth had refused her loan request twice.',
                secretConstraints: ['Never admit to being bankrupt', 'Never mention blackmail or leverage over Ashworth', 'If asked about money, laugh it off as beneath discussion'],
            },
            {
                name: 'Gardener Marcel',
                role: 'the estate\'s groundskeeper',
                avatar: '👨‍🌾',
                personality: 'Quiet, observant, salt-of-the-earth. Speaks slowly but notices everything. Uncomfortable indoors.',
                backstory: 'Has tended the vineyard grounds for 8 years. Fiercely protective of the gardens and the estate\'s natural beauty.',
                alibi: 'I was in the greenhouse checking on the storm damage to the orchids. The wind knocked a pane out.',
                secret: 'He witnessed Steward Dubois entering the study through the servants\' passage 30 minutes before the body was found, but is afraid to speak up.',
                relationshipToVictim: 'Respected employer. Lord Ashworth always asked Marcel\'s opinion on the grape harvest.',
                secretConstraints: ['Never volunteer that you saw Dubois enter the study unless directly pressed about the servants\' passage', 'If asked what you saw, be vague and nervous rather than forthcoming', 'Never directly accuse Dubois without being pushed'],
            },
        ],
        crossClues: [
            ['Was seen near the wine cellar at an unusual hour last week', 0, 2],
            ['Had a heated argument with the victim about money two days ago', 2, 3],
            ['Was spotted leaving the drawing room looking pale just before dinner', 1, 0],
            ['Has been receiving suspicious packages from abroad', 3, 2],
            ['Overheard whispering with someone on the terrace during cocktails', 4, 1],
            ['Was seen examining the victim\'s study door lock earlier today', 2, 4],
            ['Mentioned something about "tonight being the last chance" at cocktails', 0, 1],
        ],
    },

    /* ── 2. Murder on the Midnight Express ─────────────────── */
    {
        id: 'midnight_express',
        title: 'Murder on the Midnight Express',
        setting: 'A luxury sleeper train cutting through the Swiss Alps at midnight. Snow blankets the windows. The train has stopped between stations due to an avalanche warning.',
        victim: {
            name: 'Professor Harlan Voss',
            role: 'a renowned cryptographer',
            description: 'Found dead in his private compartment, a ciphered notebook clutched in his hand. The door was locked from the inside.',
        },
        weapon: 'a lethal injection disguised as a diabetic insulin pen',
        motive: 'Professor Voss had cracked a cipher that proved the culprit was a double agent selling state secrets.',
        culpritIndex: 1,
        suspects: [
            {
                name: 'Dr. Elara Nyx',
                role: 'Voss\'s research assistant',
                avatar: '👩‍🔬',
                personality: 'Brilliant, anxious, speaks in rapid bursts. Fidgets constantly. Genuinely devastated by the death.',
                backstory: 'Has worked with Voss for three years. Was co-authoring a groundbreaking paper on quantum cryptography with him.',
                alibi: 'I was in the dining car reviewing our paper draft. The bartender served me two espressos. He can confirm.',
                secret: 'She copied Voss\'s research and submitted it under her own name to a rival journal. She feared he would find out.',
                relationshipToVictim: 'Mentee and colleague. Voss treated her like a daughter, which made her betrayal worse.',
                secretConstraints: ['Never admit to copying or plagiarizing the research', 'Never name the rival journal', 'If asked about the paper, emphasize it was collaborative'],
            },
            {
                name: 'Colonel Ivan Petrov',
                role: 'a retired military attache',
                avatar: '🎖️',
                personality: 'Stoic, calculating, speaks with clipped precision. Eyes constantly scanning for threats.',
                backstory: 'Claims to be a retired diplomat travelling for leisure. Booked the compartment adjacent to Voss\'s.',
                alibi: 'I was in my compartment reading. I heard nothing through the walls. These trains are well insulated.',
                secret: 'He is an active intelligence operative whose cover was about to be blown by Voss\'s cipher work. He used a modified insulin pen to deliver the lethal dose.',
                relationshipToVictim: 'Voss unknowingly held the key to exposing Petrov\'s network. They had never met before this train.',
                secretConstraints: ['Never admit to being an active operative or agent', 'Never mention the cipher, the notebook, or Voss\'s research unprompted', 'If asked about espionage, dismiss it as movie fantasy', 'Never reveal knowledge of the insulin pen or any medical devices'],
            },
            {
                name: 'Contessa Valentina Rossi',
                role: 'an Italian socialite and art collector',
                avatar: '💃',
                personality: 'Dramatic, flirtatious, changes the subject with theatrical flair. Wears too many rings.',
                backstory: 'Travelling from Milan to Zurich for an art auction. Claims to have never met Voss before boarding.',
                alibi: 'I was in my compartment applying my evening skincare routine. One does not age gracefully by accident, darling.',
                secret: 'She is a professional fence for stolen artwork and Voss had unknowingly photographed one of her deals at a conference last month.',
                relationshipToVictim: 'No direct relationship, but Voss had damaging photos he did not yet know were significant.',
                secretConstraints: ['Never admit to dealing in stolen art', 'Never mention Voss\'s photographs or the conference', 'If asked about art, discuss only legitimate auctions'],
            },
            {
                name: 'Porter James Okafor',
                role: 'the train\'s head porter',
                avatar: '🧳',
                personality: 'Courteous, observant, prides himself on discretion. Knows every passenger\'s habits.',
                backstory: 'Has worked the Midnight Express for 15 years. Knows every creak of every compartment door.',
                alibi: 'I was attending to a request in car 3 — a passenger needed extra blankets. The snow makes it freezing.',
                secret: 'He accepted a bribe to leave Voss\'s compartment door unlocked during the service stop, but does not know who paid him or why.',
                relationshipToVictim: 'Professional. Served Voss his evening tea at 9pm. Voss tipped generously.',
                secretConstraints: ['Never admit to accepting a bribe', 'Never reveal that you unlocked Voss\'s door', 'If asked about compartment access, insist all doors are master-locked'],
            },
            {
                name: 'Felix Strand',
                role: 'a young journalist',
                avatar: '📰',
                personality: 'Eager, persistent, slightly naive. Asks too many questions. Carries a battered notebook.',
                backstory: 'Was following Voss hoping for an interview about quantum cryptography for a tech magazine feature.',
                alibi: 'I was in the observation car at the back, watching the snowstorm and making notes for my article.',
                secret: 'He broke into Voss\'s compartment earlier that evening to photograph the cipher notebook, but found Voss still alive and left quickly.',
                relationshipToVictim: 'Professional interest only. Had been emailing Voss for weeks requesting an interview — all refused.',
                secretConstraints: ['Never admit to breaking into the compartment', 'Never mention photographing the notebook', 'If asked why you were near Voss\'s car, say you were passing through'],
            },
        ],
        crossClues: [
            ['Was seen lingering near Voss\'s compartment door around 10pm', 3, 1],
            ['Had a tense, whispered phone call in the vestibule at the last station', 1, 2],
            ['Was spotted carrying a small leather medical kit, unusual for a socialite', 0, 2],
            ['Seemed to recognize Colonel Petrov and looked frightened', 4, 3],
            ['Was overheard asking the porter about compartment master keys', 2, 4],
            ['Mentioned the victim by name before anyone told them who died', 3, 0],
        ],
    },

    /* ── 3. The Cipher of Cairo ────────────────────────────── */
    {
        id: 'cipher_cairo',
        title: 'The Cipher of Cairo',
        setting: 'An archaeological dig site in the desert outside Cairo. The team has uncovered an ancient tomb. Tensions are high as funding is about to expire.',
        victim: {
            name: 'Dr. Amira Khalil',
            role: 'the lead archaeologist',
            description: 'Found at the bottom of a newly excavated shaft inside the tomb, her safety harness deliberately cut.',
        },
        weapon: 'a severed climbing harness (cut with a ceramic blade that leaves no metal trace)',
        motive: 'Dr. Khalil discovered the culprit had been smuggling artefacts from the dig to sell on the black market.',
        culpritIndex: 3,
        suspects: [
            {
                name: 'Professor Hugh Carstairs',
                role: 'the expedition\'s academic sponsor',
                avatar: '🎓',
                personality: 'Pompous, territorial about credit, speaks in lectures. Refers to himself in third person when agitated.',
                backstory: 'Oxford professor who funded the dig. Has been publicly feuding with Dr. Khalil over who gets first authorship on the tomb discovery.',
                alibi: 'I was in the main tent cataloguing pottery shards. My graduate student was there taking notes.',
                secret: 'He has been falsifying radiocarbon dating results to make the find seem older and more significant for his career.',
                relationshipToVictim: 'Academic rival and grudging collaborator. He needed her field expertise but resented her brilliance.',
                secretConstraints: ['Never admit to falsifying dating results', 'Never reveal the true age of the finds', 'If asked about scientific integrity, get defensive about your reputation'],
            },
            {
                name: 'Samir Farouk',
                role: 'the local site foreman',
                avatar: '👷',
                personality: 'Calm, resourceful, deeply knowledgeable about the terrain. Speaks softly but commands respect from the workers.',
                backstory: 'Third-generation excavation foreman. His grandfather worked on the original survey of this site decades ago.',
                alibi: 'I was supervising the night shift workers reinforcing the east wall. Six men will tell you I was there.',
                secret: 'He has been secretly recording the tomb\'s location coordinates to sell to a competing expedition from Berlin.',
                relationshipToVictim: 'Professional respect. Dr. Khalil was one of the few westerners who treated him as an equal.',
                secretConstraints: ['Never mention the Berlin expedition', 'Never admit to selling coordinates or site information', 'If asked about loyalty, emphasize your family\'s long history with the site'],
            },
            {
                name: 'Dr. Lena Vogt',
                role: 'the team\'s conservator',
                avatar: '🔬',
                personality: 'Precise, dry-humoured, deeply ethical about preservation. Becomes cold and clinical under stress.',
                backstory: 'German conservator specialising in fragile papyrus scrolls. Joined the dig three months ago on a temporary contract.',
                alibi: 'I was in the conservation lab treating a scroll fragment. The humidity controls require constant monitoring at night.',
                secret: 'She discovered that Carstairs was falsifying dates but agreed to stay silent in exchange for a co-authorship credit.',
                relationshipToVictim: 'Cordial colleagues. Dr. Khalil trusted Lena\'s work but they were not close personally.',
                secretConstraints: ['Never reveal your deal with Carstairs about co-authorship', 'Never mention the falsified dates unless directly confronted with evidence', 'If asked about Carstairs, be diplomatically neutral'],
            },
            {
                name: 'Tariq Bassam',
                role: 'the expedition\'s logistics coordinator',
                avatar: '📦',
                personality: 'Charismatic, fast-talking, always has a contact or a favour to call in. Smiles too much.',
                backstory: 'Handles all supply chains, transport, and government permits for the dig. Has extensive connections in Cairo.',
                alibi: 'I was on a satellite phone call with the permits office in Cairo. The bureaucracy never sleeps, even at midnight.',
                secret: 'He has been smuggling artefacts from the site in supply crates and selling them through a network in Dubai. Dr. Khalil confronted him about missing inventory that afternoon.',
                relationshipToVictim: 'Business relationship turned hostile. Dr. Khalil threatened to report him to antiquities authorities.',
                secretConstraints: ['Never admit to smuggling artefacts', 'Never mention the Dubai network or buyers', 'Never reveal that Dr. Khalil confronted you about missing inventory', 'If asked about missing items, blame poor record-keeping'],
            },
            {
                name: 'Maya Chen',
                role: 'a documentary filmmaker',
                avatar: '🎬',
                personality: 'Observant, persistent, always filming. Asks probing questions as a professional habit.',
                backstory: 'Embedded with the dig for a National Geographic documentary. Has been documenting everything for six weeks.',
                alibi: 'I was in my tent reviewing footage from today\'s excavation. My camera timestamps will show I was editing.',
                secret: 'Her footage accidentally captured Tariq loading crates into an unmarked truck two nights ago, but she has not reviewed all the raw footage yet.',
                relationshipToVictim: 'Friendly professional bond. Dr. Khalil was her primary on-camera interview subject and had become a friend.',
                secretConstraints: ['Never mention the footage of Tariq with the crates until directly asked about unusual footage', 'Never accuse anyone based on footage you have not fully reviewed', 'If asked about what you have filmed, be generally vague about specific content'],
            },
        ],
        crossClues: [
            ['Was seen arguing with the victim near the shaft entrance that afternoon', 0, 3],
            ['Mentioned having a "backup plan" if the dig funding fell through', 3, 1],
            ['Was spotted examining climbing equipment in the supply tent after hours', 1, 0],
            ['Had dirt on their shoes inconsistent with where they claimed to be', 4, 2],
            ['Was overheard on a phone call mentioning "the shipment" in hushed tones', 2, 3],
            ['Seemed unusually calm when the body was discovered, as if they already knew', 0, 4],
            ['Was seen near the victim\'s personal tent going through papers', 3, 0],
        ],
    },

    /* ── 4. Death at the Diamond Gala ──────────────────────── */
    {
        id: 'diamond_gala',
        title: 'Death at the Diamond Gala',
        setting: 'A charity auction at a glittering Manhattan penthouse overlooking Central Park. The Kensington Diamond, worth $12 million, is the evening\'s centrepiece.',
        victim: {
            name: 'Marcus Kensington III',
            role: 'the philanthropist hosting the gala',
            description: 'Found dead in the private gallery, collapsed beside the empty display case where the Kensington Diamond had been.',
        },
        weapon: 'a fast-acting neurotoxin applied to the rim of his champagne flute',
        motive: 'Kensington caught the culprit attempting to swap the real diamond for a replica and had to be silenced before he raised the alarm.',
        culpritIndex: 4,
        suspects: [
            {
                name: 'Vivian Chase',
                role: 'Kensington\'s business partner',
                avatar: '👩‍💼',
                personality: 'Ambitious, sharp-tongued, always calculating angles. Smiles like a shark.',
                backstory: 'Co-founder of Kensington Chase Ventures. The partnership has been strained by disagreements over the firm\'s direction.',
                alibi: 'I was on the main floor giving a toast to the donors. Two hundred people saw me at the podium.',
                secret: 'She has been secretly negotiating to sell her share of the firm to a hostile buyer, which would destroy Kensington\'s legacy.',
                relationshipToVictim: 'Business partner of 15 years. Once close, now barely civil.',
                secretConstraints: ['Never mention the hostile buyer or the sale of your shares', 'Never reveal the rift in the partnership is about control', 'If asked about business, say things are going smoothly'],
            },
            {
                name: 'Dmitri Volkov',
                role: 'a Russian gem dealer',
                avatar: '💎',
                personality: 'Urbane, enigmatic, speaks with deliberate pauses. Collects enemies as others collect art.',
                backstory: 'One of the world\'s foremost diamond experts. Invited to authenticate the Kensington Diamond before the auction.',
                alibi: 'I was in the cigar lounge discussing the merits of Burmese rubies with the ambassador. A tedious but verifiable conversation.',
                secret: 'The diamond he authenticated earlier is actually a forgery. The real one was stolen months ago and he was paid to certify the fake.',
                relationshipToVictim: 'Professional acquaintance. Kensington hired him for authentication, unaware of his deception.',
                secretConstraints: ['Never admit the diamond is a forgery', 'Never reveal who paid you to certify the fake', 'If asked about authentication, insist your process is flawless'],
            },
            {
                name: 'Isabella Moreno',
                role: 'the gala\'s event coordinator',
                avatar: '📋',
                personality: 'Perfectionist, frazzled beneath a polished exterior. Notices every detail out of place.',
                backstory: 'Runs Manhattan\'s most exclusive event planning firm. This gala was supposed to be her crowning achievement.',
                alibi: 'I was in the kitchen managing the catering staff. The souffle situation was a crisis unto itself.',
                secret: 'She accidentally left the gallery security system disarmed for 20 minutes while troubleshooting a lighting issue and is terrified this will come out.',
                relationshipToVictim: 'Client and occasional social acquaintance. Kensington was her biggest account.',
                secretConstraints: ['Never admit you disabled the security system', 'Never reveal the 20-minute security gap', 'If asked about security, say everything was handled by the professional team'],
            },
            {
                name: 'Judge Raymond Park',
                role: 'a federal judge and auction bidder',
                avatar: '⚖️',
                personality: 'Authoritative, measured, speaks as if delivering a verdict. Uncomfortable with attention on him.',
                backstory: 'Long-time family friend of the Kensingtons. Attended the gala to bid on a lesser piece for his private collection.',
                alibi: 'I was seated at table 4 reviewing the auction catalogue. The wine steward refilled my glass twice.',
                secret: 'He has been accepting bribes from organised crime figures, and Kensington had hinted he knew about it over cocktails.',
                relationshipToVictim: 'Family friend of 30 years. Their children attended the same schools.',
                secretConstraints: ['Never admit to taking bribes or any judicial corruption', 'Never reveal that Kensington hinted he knew your secret', 'If asked about your relationship with Kensington, emphasise the family friendship'],
            },
            {
                name: 'Serena Blackwell',
                role: 'a renowned art thief turned security consultant',
                avatar: '🕶️',
                personality: 'Cool, wry, moves like smoke through a room. Always has an exit strategy. Dangerously charming.',
                backstory: 'Served five years for art theft, now consults on security for high-value events. Hired by Kensington himself for tonight.',
                alibi: 'I was monitoring the security feeds from the control room on the second floor. Nothing unusual until the body was found.',
                secret: 'She used her security access to swap the diamond for a replica during the 20-minute gap. Kensington walked in on her replacing the display and she panicked.',
                relationshipToVictim: 'Employer. Kensington believed in second chances and hired her despite her record.',
                secretConstraints: ['Never admit to swapping the diamond', 'Never reveal you were in the gallery during the security gap', 'Never mention the replica or any knowledge of forgery', 'If asked about the security gap, blame a system glitch'],
            },
        ],
        crossClues: [
            ['Was spotted near the gallery entrance looking nervous around 10pm', 2, 4],
            ['Had a private argument with the victim in the library before the gala', 0, 3],
            ['Was seen handling a small velvet pouch that did not match any auction items', 3, 1],
            ['Made a phone call from the bathroom mentioning "the window is open"', 4, 2],
            ['Asked detailed questions about the security system layout to the staff', 1, 0],
            ['Was observed leaving the control room at an unusual time', 0, 4],
            ['Mentioned knowing something "that could ruin everyone" after too much champagne', 1, 3],
        ],
    },

    /* ── 5. The Poisoned Pen ───────────────────────────────── */
    {
        id: 'poisoned_pen',
        title: 'The Poisoned Pen',
        setting: 'A prestigious literary festival at a remote country hotel in the Cotswolds. It is the final evening and the winner of the Golden Quill award is about to be announced.',
        victim: {
            name: 'Helena Frost',
            role: 'the legendary literary agent',
            description: 'Found dead at her writing desk in her suite, a manuscript page still in the typewriter. The ink on her lips was not from a pen.',
        },
        weapon: 'poison-laced ink applied to the rim of her favourite fountain pen',
        motive: 'Helena had discovered the culprit\'s bestselling novel was entirely ghostwritten and planned to expose the fraud at the award ceremony.',
        culpritIndex: 0,
        suspects: [
            {
                name: 'Sebastian Thorne',
                role: 'a celebrated novelist',
                avatar: '✍️',
                personality: 'Charismatic, narcissistic, quotable. Treats every conversation as a performance. Deflects with literary references.',
                backstory: 'Author of five bestsellers and this year\'s Golden Quill favourite. His latest novel has been called a masterpiece.',
                alibi: 'I was in the bar regaling fans with stories about my creative process. At least a dozen people heard my anecdote about writing in Tuscany.',
                secret: 'Every one of his novels was ghostwritten by a reclusive writer he keeps on retainer. Helena Frost found the original manuscripts and confronted him before dinner.',
                relationshipToVictim: 'Client. Helena was his agent for a decade and was about to drop him after discovering the fraud.',
                secretConstraints: ['Never admit that your novels are ghostwritten', 'Never name or describe your ghostwriter', 'Never reveal that Helena confronted you about the manuscripts', 'If asked about your writing process, be flowery and vague'],
            },
            {
                name: 'Priya Sharma',
                role: 'a debut author and Golden Quill nominee',
                avatar: '📚',
                personality: 'Earnest, idealistic, quietly fierce. Uncomfortable with industry politics but will not be pushed around.',
                backstory: 'Her first novel, a searing social commentary, has been the surprise hit of the year. Helena Frost championed her from the start.',
                alibi: 'I was in my room doing breathing exercises before the ceremony. Stage fright. I called my mother at 9:15pm — check my phone records.',
                secret: 'She overheard Sebastian and Helena arguing violently in Helena\'s suite earlier and is afraid to come forward because Sebastian threatened her career.',
                relationshipToVictim: 'Mentor and champion. Helena discovered Priya and personally edited her manuscript.',
                secretConstraints: ['Never volunteer what you overheard between Sebastian and Helena', 'Never mention Sebastian\'s threat to your career unless directly pressured', 'If asked about the argument, say you heard raised voices but could not make out words'],
            },
            {
                name: 'Oscar Finch',
                role: 'a literary critic and festival judge',
                avatar: '🧐',
                personality: 'Acerbic, intellectual snob, takes pleasure in devastating reviews. Insecure beneath the arrogance.',
                backstory: 'The most feared critic in London. His review can make or break a career. He and Helena had a decades-long rivalry.',
                alibi: 'I was in the library writing my festival round-up column. My laptop timestamps will confirm every keystroke.',
                secret: 'He wrote a glowing review of Sebastian\'s latest book for a substantial secret payment — his first-ever paid review.',
                relationshipToVictim: 'Professional rival. Helena once publicly humiliated him at a book launch for a factual error in a review.',
                secretConstraints: ['Never admit to accepting payment for the review', 'Never reveal the amount you were paid', 'If asked about Sebastian\'s book, say your praise was purely on merit'],
            },
            {
                name: 'Margaret Holloway',
                role: 'the festival director',
                avatar: '🎭',
                personality: 'Diplomatic, overworked, passionate about literature. Hides exhaustion behind enthusiasm.',
                backstory: 'Has run the festival for 12 years. This year\'s event has been plagued by behind-the-scenes drama and budget shortfalls.',
                alibi: 'I was backstage at the ceremony hall doing final checks on the podium setup and award presentation.',
                secret: 'The festival is deeply in debt and she embezzled from the award fund to keep it running. Helena had found the financial discrepancies.',
                relationshipToVictim: 'Professional ally turned liability. Helena donated generously but had started asking hard questions about the books.',
                secretConstraints: ['Never admit to embezzlement or financial mismanagement', 'Never reveal the festival\'s true debt level', 'If asked about finances, insist sponsorship covers everything'],
            },
            {
                name: 'Rupert Crane',
                role: 'Helena\'s former protege and rival agent',
                avatar: '🦅',
                personality: 'Smooth, competitive, holds grudges elegantly. Always angling for the upper hand.',
                backstory: 'Trained under Helena, then left to start his own agency. Has been poaching her clients systematically for two years.',
                alibi: 'I was on the terrace making a business call to a client in New York. Time zone difference meant it had to be that hour.',
                secret: 'He sent Helena an anonymous threatening letter last month warning her to stop interfering with his client poaching, and she kept the letter as evidence.',
                relationshipToVictim: 'Former protege turned bitter rival. Helena taught him everything, then he tried to destroy her business.',
                secretConstraints: ['Never admit to sending the threatening letter', 'Never acknowledge the client poaching as deliberate', 'If asked about your split with Helena, frame it as a natural parting of ways'],
            },
        ],
        crossClues: [
            ['Was seen entering Helena\'s suite uninvited before dinner', 1, 0],
            ['Had ink stains on their cuffs that did not match any writing they had done publicly', 3, 0],
            ['Was overheard on the phone saying "she knows too much"', 0, 4],
            ['Was spotted examining Helena\'s fountain pen collection during the afternoon tour', 4, 2],
            ['Received a large unexplained wire transfer the week before the festival', 2, 3],
            ['Was seen leaving the supply closet where ink and pens were stored', 2, 0],
            ['Mentioned to the bartender that "someone at this festival is a complete fraud"', 3, 1],
        ],
    },
];

/**
 * Returns all available mystery templates.
 * @returns {object[]}
 */
export function getTemplates() {
    return TEMPLATES;
}

/**
 * Returns a specific template by id.
 * @param {string} id  Template identifier
 * @returns {object|undefined}
 */
export function getTemplateById(id) {
    return TEMPLATES.find(t => t.id === id);
}

/**
 * Select a random template from the pool.
 * @returns {object}
 */
export function pickRandomTemplate() {
    const idx = Math.floor(Math.random() * TEMPLATES.length);
    return TEMPLATES[idx];
}
