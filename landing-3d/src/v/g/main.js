import './style.css';
import { boot } from '../boot.js';

boot({ loadScene: () => import('./scene.js') });
