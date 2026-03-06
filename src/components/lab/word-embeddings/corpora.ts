// -----------------------------------------------------------------
// Preset corpora for Word2Vec training
// -----------------------------------------------------------------

export interface Corpus {
  readonly label: string;
  readonly text: string;
}

export const CORPORA: readonly Corpus[] = [
  {
    label: "Fairy Tale",
    text: `Once upon a time in a faraway kingdom there lived a young prince and a beautiful princess.
The prince was brave and strong and the princess was kind and wise.
One day a terrible dragon came to the kingdom and threatened the people.
The king called upon the prince to save the kingdom from the dragon.
The prince took his sword and shield and rode his horse to the mountain.
The dragon was fierce and breathed fire but the prince was not afraid.
After a long battle the prince defeated the dragon and saved the kingdom.
The princess was grateful and the king rewarded the prince with gold and jewels.
The prince and the princess fell in love and were married in a grand ceremony.
The king and queen were happy and the kingdom celebrated for many days.
The brave prince became a great king and the wise princess became a beloved queen.
They ruled the kingdom with kindness and justice for many years.
The people loved their king and queen and the kingdom prospered.
Every child in the kingdom heard the tale of the brave prince and the fierce dragon.
The old king told stories of battles and glory to his grandchildren.
The queen taught the children wisdom and compassion in the royal gardens.
Knights and warriors came from distant lands to serve the great king.
The castle stood tall upon the hill overlooking the peaceful kingdom.
Merchants brought silks and spices from faraway lands to the royal court.
The prince had learned courage from his father the old king.
The princess had learned grace from her mother the gentle queen.
Together the king and queen built a kingdom of peace and prosperity.
The dragon's defeat was celebrated every year with a grand festival.
Young boys dreamed of becoming brave knights like the prince.
Young girls admired the wisdom and beauty of the princess.
The kingdom flourished under the rule of the good king and queen.`,
  },
  {
    label: "Tech Article",
    text: `Machine learning is a subset of artificial intelligence that enables computers to learn from data.
Deep learning is a type of machine learning that uses neural networks with many layers.
Neural networks are inspired by the structure of the human brain and consist of interconnected nodes.
Each node in a neural network processes input data and passes the result to the next layer.
The training process involves adjusting the weights of connections between nodes.
Gradient descent is an optimization algorithm used to minimize the loss function during training.
The loss function measures how well the model predictions match the actual data.
Backpropagation is the algorithm used to compute gradients for updating network weights.
Convolutional neural networks are specialized for processing images and visual data.
Recurrent neural networks are designed for processing sequential data like text and speech.
Transformers are a modern architecture that uses attention mechanisms for parallel processing.
Attention allows the model to focus on relevant parts of the input data.
Large language models are trained on vast amounts of text data from the internet.
These models learn patterns and relationships between words and concepts.
Word embeddings represent words as dense vectors in a continuous space.
Similar words have similar vector representations in the embedding space.
Transfer learning allows models trained on one task to be applied to related tasks.
Fine tuning adapts a pretrained model to a specific task with additional training.
The training data must be carefully prepared and cleaned before use.
Overfitting occurs when a model memorizes the training data instead of learning general patterns.
Regularization techniques help prevent overfitting and improve generalization.
The model architecture determines the capacity and capabilities of the neural network.
Hyperparameters like learning rate and batch size affect the training process.
Evaluation metrics measure the performance of trained models on test data.
Computer vision and natural language processing are two major areas of deep learning.
Reinforcement learning trains agents to make decisions by maximizing rewards.`,
  },
  {
    label: "Cooking Recipe",
    text: `To make a delicious pasta dish you need fresh ingredients and a good recipe.
Start by boiling a large pot of salted water for the pasta.
While the water heats chop the fresh garlic onion and tomatoes.
Heat olive oil in a large pan over medium heat.
Add the chopped garlic and onion to the hot pan and cook until soft.
Add the fresh tomatoes and a pinch of salt and pepper to the pan.
Let the sauce simmer on low heat for about twenty minutes.
Cook the pasta in the boiling water until it is tender but firm.
Drain the pasta and add it to the pan with the tomato sauce.
Toss the pasta with the sauce and add fresh basil leaves.
Serve the pasta on warm plates with grated cheese on top.
A good chef always tastes the food before serving it to guests.
Fresh herbs like basil and parsley add wonderful flavor to any dish.
The secret to great cooking is using quality ingredients and proper technique.
Olive oil is essential in Mediterranean cooking and adds rich flavor.
Garlic and onion form the base of many classic sauces and soups.
A sharp knife and a heavy pan are the most important tools in the kitchen.
Season your food with salt and pepper throughout the cooking process.
Fresh bread is the perfect accompaniment to a hearty pasta dish.
A simple salad with olive oil and lemon makes a refreshing side dish.
The best meals are made with love and shared with family and friends.
Cooking is both an art and a science that anyone can learn.
Practice makes perfect when it comes to mastering kitchen techniques.
A well stocked pantry with pasta rice and canned tomatoes is essential.
Fresh vegetables from the market make the most flavorful dishes.
Dessert should be light and sweet after a rich and savory meal.`,
  },
  {
    label: "Shakespeare Sonnet",
    text: `Shall I compare thee to a summer day thou art more lovely and more temperate.
Rough winds do shake the darling buds of May and summer lease hath all too short a date.
Sometime too hot the eye of heaven shines and often is his gold complexion dimmed.
And every fair from fair sometime declines by chance or nature changing course untrimmed.
But thy eternal summer shall not fade nor lose possession of that fair thou owe.
Nor shall death brag thou wander in his shade when in eternal lines to time thou grow.
So long as men can breathe or eyes can see so long lives this and this gives life to thee.
When I do count the clock that tells the time and see the brave day sunk in hideous night.
When I behold the violet past prime and sable curls all silvered over with white.
When lofty trees I see barren of leaves which erst from heat did canopy the herd.
Then of thy beauty do I question make that thou among the wastes of time must go.
Love is not love which alters when it alteration finds or bends with the remover to remove.
It is an ever fixed mark that looks on tempests and is never shaken.
Love alters not with his brief hours and weeks but bears it out even to the edge of doom.
If this be error and upon me proved I never writ nor no man ever loved.
My mistress eyes are nothing like the sun coral is far more red than her lips red.
If snow be white why then her breasts are dun if hairs be wires black wires grow on her head.
I have seen roses damasked red and white but no such roses see I in her cheeks.
And in some perfumes is there more delight than in the breath that from my mistress reeks.
I love to hear her speak yet well I know that music hath a far more pleasing sound.
My mistress when she walks treads on the ground and yet by heaven I think my love as rare.
As any she belied with false compare.
Let me not to the marriage of true minds admit impediments love is not love.
From fairest creatures we desire increase that thereby beauty rose might never die.
But as the riper should by time decrease his tender heir might bear his memory.`,
  },
] as const;
