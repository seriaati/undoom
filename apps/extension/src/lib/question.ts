export interface Question {
  text: string;
  answer: number;
}

export function newQuestion(random: () => number = Math.random): Question {
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  if (random() < 0.5) {
    const a = pick(3, 12);
    const b = pick(3, 12);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  const a = pick(12, 89);
  const b = pick(12, 89);
  return { text: `${a} + ${b}`, answer: a + b };
}

export function isCorrect(question: Question, input: string): boolean {
  return input.trim() !== "" && Number(input.trim()) === question.answer;
}
