import { mount } from 'svelte';
import App from './App.svelte';
import './global.css';
import './styles/components.css';

const saved = localStorage.getItem('theme');
if (saved) {
  document.documentElement.setAttribute('data-theme', saved);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

const app = mount(App, { target: document.getElementById('app') });

export default app;
