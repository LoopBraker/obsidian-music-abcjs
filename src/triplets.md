To create eighth-note triplets in abcjs, you use a specific tuplet notation within the ABC string. The standard format for an eighth-note triplet is (3abc or (3::2abc, which tells the renderer to put three notes in the time normally occupied by two notes of that same value. 
Here are examples of how to format eighth-note triplets in abcjs:
Basic Eighth-Note Triplet: Three eighth notes (represented as single letters, e.g., c, d, e) in the time of a quarter note.
abc
(3cde
This renders three eighth notes where c, d, and e are notes of the specified default length (usually an eighth note, depending on the L: field).
Explicit Tuplet Specification: For clarity or when the default length is different, you can explicitly define the ratio:
abc
(3::2cde
This means "put 3 notes into the time of 2" (specifically, two of whatever the current default note length L: is).
Triplets with Different Note Values (e.g., an eighth and a quarter): You can use length modifiers (/ for shorter, 2 for longer) within the triplet grouping:
abc
(3c2d
This would be an eighth note followed by a quarter note in the time of a quarter note (two eighth notes). The total duration of the notes inside the parentheses should match the expected duration of two eighth notes.
Using Rests within Triplets: Rests are also part of the tuplet group and use the z character:
abc
(3czd
This is an eighth note, an eighth rest, and an eighth note, all played in the space of one quarter note. 
Example abcjs Tune with Triplets
You can test these examples using an online abcjs editor. 
abc
X:1
T:Eighth Note Triplets
M:4/4
L:1/8
K:C
CDEF | (3GAB cdef | (3gfe (3dcB | c4 |]

This snippet first shows four regular eighth notes, followed by two measures containing eighth-note triplets, and ends with a whole note. 