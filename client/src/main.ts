import { GameManager } from './managers/GameManager';
import { LoginScreen } from './ui/LoginScreen';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

let game: GameManager | null = null;
let loginScreen: LoginScreen | null = null;

function startGame(token: string, username: string) {
  // Hide canvas until game is ready
  canvas.style.display = 'block';

  if (loginScreen) {
    loginScreen.destroy();
    loginScreen = null;
  }

  game = new GameManager(canvas, token, username, () => {
    // On disconnect — show login screen again
    handleDisconnect();
  });
}

function handleDisconnect() {
  if (game) {
    game.destroy();
    game = null;
  }
  showLoginScreen();
}

function showLoginScreen() {
  canvas.style.display = 'none';
  loginScreen = new LoginScreen((token, username) => {
    startGame(token, username);
  });
}

// Check for existing session
const savedToken = localStorage.getItem('projectrs_token');
const savedUsername = localStorage.getItem('projectrs_username');

if (savedToken && savedUsername) {
  // Try to reconnect with saved token
  startGame(savedToken, savedUsername);
} else {
  showLoginScreen();
}
