import readingTime from "reading-time";

export interface ReadingTimeResult {
  text: string;
  minutes: number;
  words: number;
}

export function getReadingTime(content: string): ReadingTimeResult {
  const result = readingTime(content);
  return {
    text: result.text,
    minutes: result.minutes,
    words: result.words,
  };
}
