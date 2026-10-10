import type { SpritePlayer } from './sprite-player.ts';

/**
 * Live sprite players by character id, so the typewriter can toggle mouth animation imperatively
 * (no React render per typed character).
 */
const players = new Map<string, SpritePlayer>();

export const spriteRegistry = {
  register(char: string, player: SpritePlayer): () => void {
    players.set(char, player);
    return () => {
      if (players.get(char) === player) players.delete(char);
    };
  },
  setTalking(char: string, talking: boolean): void {
    players.get(char)?.setTalking(talking);
  },
};
