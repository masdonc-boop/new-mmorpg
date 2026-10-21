import { itemDef } from '../data/items';

const cache = new Map<string, string>();

/** Procedurally painted item icons (original art, no external assets). Returns a data URL. */
export function itemIcon(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const d = itemDef(id);
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const { shape, color, accent = '#ffffff' } = d.icon;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const outline = (w = 3) => {
    g.lineWidth = w;
    g.strokeStyle = 'rgba(20,12,6,0.85)';
    g.stroke();
  };
  const shadow = () => {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.ellipse(32, 54, 20, 5, 0, 0, Math.PI * 2);
    g.fill();
  };
  shadow();
  switch (shape) {
    case 'log': {
      g.save();
      g.translate(32, 34);
      g.rotate(-0.5);
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(-22, -9, 40, 18, 4);
      g.fill();
      outline();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      for (const y of [-3, 3]) {
        g.beginPath();
        g.moveTo(-18, y);
        g.lineTo(10, y + 1);
        g.stroke();
      }
      g.fillStyle = accent;
      g.beginPath();
      g.ellipse(18, 0, 6, 9, 0, 0, Math.PI * 2);
      g.fill();
      outline(2.5);
      g.strokeStyle = 'rgba(120,70,30,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(18, 0, 3, 5, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      break;
    }
    case 'ore': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(14, 44);
      g.lineTo(18, 24);
      g.lineTo(32, 14);
      g.lineTo(48, 20);
      g.lineTo(52, 40);
      g.lineTo(40, 50);
      g.lineTo(22, 50);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(18, 24);
      g.lineTo(32, 14);
      g.lineTo(34, 28);
      g.lineTo(22, 34);
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      for (const [x, y, r] of [[26, 30, 5], [40, 26, 4], [36, 40, 5], [24, 43, 3]]) {
        g.beginPath();
        g.moveTo(x, y - r);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r);
        g.lineTo(x - r, y);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'gem': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(32, 12);
      g.lineTo(50, 28);
      g.lineTo(32, 52);
      g.lineTo(14, 28);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = accent;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(32, 12);
      g.lineTo(40, 28);
      g.lineTo(32, 34);
      g.lineTo(24, 28);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'coins': {
      for (const [x, y] of [[22, 42], [40, 42], [31, 34], [26, 26], [38, 24]]) {
        g.fillStyle = color;
        g.beginPath();
        g.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2);
        g.fill();
        outline(2.5);
        g.fillStyle = accent;
        g.beginPath();
        g.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'arrow': {
      for (const off of [-6, 0, 6]) {
        g.save();
        g.translate(32 + off, 34);
        g.rotate(-0.8);
        g.strokeStyle = 'rgba(20,12,6,0.85)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-20, 0);
        g.lineTo(18, 0);
        g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = '#9aa0a8';
        g.beginPath();
        g.moveTo(24, 0);
        g.lineTo(16, -5);
        g.lineTo(16, 5);
        g.closePath();
        g.fill();
        outline(2);
        g.fillStyle = accent;
        g.beginPath();
        g.moveTo(-20, 0);
        g.lineTo(-14, -6);
        g.lineTo(-10, 0);
        g.lineTo(-14, 6);
        g.closePath();
        g.fill();
        g.restore();
      }
      break;
    }
    case 'rune': {
      g.fillStyle = '#b8b2a6';
      g.beginPath();
      g.roundRect(14, 14, 36, 36, 9);
      g.fill();
      outline();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(18, 18, 28, 28, 7);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(32, 32, 8, 0.3, Math.PI * 1.7);
      g.moveTo(24, 26);
      g.quadraticCurveTo(32, 20, 40, 26);
      g.stroke();
      break;
    }
    case 'gel': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(32, 12);
      g.bezierCurveTo(46, 28, 52, 34, 48, 44);
      g.bezierCurveTo(44, 54, 20, 54, 16, 44);
      g.bezierCurveTo(12, 34, 18, 28, 32, 12);
      g.fill();
      outline();
      g.fillStyle = accent;
      g.beginPath();
      g.ellipse(26, 36, 4, 7, -0.4, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'pelt': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(16, 18);
      g.lineTo(26, 22);
      g.lineTo(38, 22);
      g.lineTo(48, 18);
      g.lineTo(46, 32);
      g.lineTo(50, 46);
      g.lineTo(38, 44);
      g.lineTo(32, 52);
      g.lineTo(26, 44);
      g.lineTo(14, 46);
      g.lineTo(18, 32);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = accent;
      g.beginPath();
      g.ellipse(32, 34, 7, 10, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'fang': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(22, 16);
      g.quadraticCurveTo(44, 16, 44, 22);
      g.quadraticCurveTo(40, 38, 28, 52);
      g.quadraticCurveTo(30, 34, 22, 16);
      g.fill();
      outline();
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(26, 22);
      g.quadraticCurveTo(36, 24, 32, 40);
      g.stroke();
      break;
    }
    case 'bone': {
      g.save();
      g.translate(32, 33);
      g.rotate(-0.7);
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(-16, -4, 32, 8, 3);
      for (const x of [-18, 18]) {
        g.moveTo(x + 5, -5);
        g.arc(x, -5, 5, 0, Math.PI * 2);
        g.moveTo(x + 5, 5);
        g.arc(x, 5, 5, 0, Math.PI * 2);
      }
      g.fill();
      outline(2.5);
      g.restore();
      break;
    }
    case 'bread': {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(32, 36, 22, 13, 0, Math.PI, 0);
      g.lineTo(54, 42);
      g.quadraticCurveTo(32, 48, 10, 42);
      g.closePath();
      g.fill();
      outline();
      g.strokeStyle = accent;
      g.lineWidth = 3;
      for (const x of [22, 32, 42]) {
        g.beginPath();
        g.moveTo(x - 3, 28);
        g.lineTo(x + 3, 34);
        g.stroke();
      }
      break;
    }
    case 'axe':
    case 'pickaxe': {
      g.save();
      g.translate(32, 32);
      g.rotate(-0.7);
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(-3, -22, 6, 46, 3);
      g.fill();
      outline(2.5);
      g.fillStyle = color;
      g.beginPath();
      if (shape === 'axe') {
        g.moveTo(2, -20);
        g.quadraticCurveTo(20, -24, 18, -6);
        g.quadraticCurveTo(10, -10, 2, -8);
      } else {
        g.moveTo(-20, -14);
        g.quadraticCurveTo(0, -26, 20, -14);
        g.lineTo(18, -10);
        g.quadraticCurveTo(0, -18, -18, -10);
      }
      g.closePath();
      g.fill();
      outline(2.5);
      g.restore();
      break;
    }
    case 'bar': {
      // Ingot: trapezoid prism with a light top face.
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(10, 42);
      g.lineTo(54, 42);
      g.lineTo(48, 26);
      g.lineTo(16, 26);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(16, 26);
      g.lineTo(48, 26);
      g.lineTo(44, 20);
      g.lineTo(20, 20);
      g.closePath();
      g.fill();
      outline(2.5);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(18, 38);
      g.lineTo(30, 38);
      g.stroke();
      break;
    }
    case 'sword':
    case 'dagger': {
      const len = shape === 'sword' ? 34 : 20;
      g.save();
      g.translate(32, 34);
      g.rotate(-0.78);
      g.fillStyle = '#e8e6e0';
      g.beginPath();
      g.moveTo(-4, -6);
      g.lineTo(-4, -6 - len);
      g.lineTo(0, -12 - len);
      g.lineTo(4, -6 - len);
      g.lineTo(4, -6);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      outline(2.5);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(0, -6 - len);
      g.stroke();
      g.fillStyle = '#e3b64a';
      g.beginPath();
      g.roundRect(-11, -7, 22, 5, 2);
      g.fill();
      outline(2);
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(-3, -2, 6, 14, 2);
      g.fill();
      outline(2);
      g.fillStyle = '#e3b64a';
      g.beginPath();
      g.arc(0, 14, 4, 0, Math.PI * 2);
      g.fill();
      outline(2);
      g.restore();
      break;
    }
    case 'helm': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(12, 44);
      g.quadraticCurveTo(10, 12, 32, 12);
      g.quadraticCurveTo(54, 12, 52, 44);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(11, 36, 42, 8, 3);
      g.fill();
      outline(2);
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(29, 30, 6, 20, 2);
      g.fill();
      outline(2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(24, 22, 6, 4, -0.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'shield': {
      g.fillStyle = accent;
      g.beginPath();
      g.arc(32, 32, 21, 0, Math.PI * 2);
      g.fill();
      outline();
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(32, 32, 18, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(32, 32, 7, 0, Math.PI * 2);
      g.fill();
      outline(2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(30, 30, 2.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'platebody': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(20, 14);
      g.lineTo(44, 14);
      g.lineTo(56, 22);
      g.lineTo(52, 32);
      g.lineTo(46, 28);
      g.lineTo(46, 50);
      g.lineTo(18, 50);
      g.lineTo(18, 28);
      g.lineTo(12, 32);
      g.lineTo(8, 22);
      g.closePath();
      g.fill();
      outline();
      g.strokeStyle = accent;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(32, 18);
      g.lineTo(32, 48);
      g.moveTo(18, 40);
      g.lineTo(46, 40);
      g.stroke();
      g.fillStyle = '#3a2a1f';
      g.beginPath();
      g.ellipse(32, 15, 7, 3, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'platelegs': {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(16, 12);
      g.lineTo(48, 12);
      g.lineTo(50, 52);
      g.lineTo(36, 52);
      g.lineTo(32, 28);
      g.lineTo(28, 52);
      g.lineTo(14, 52);
      g.closePath();
      g.fill();
      outline();
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(15, 11, 34, 7, 2);
      g.fill();
      outline(2);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      for (const x of [21, 43]) {
        g.beginPath();
        g.arc(x, 34, 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'bow': {
      g.save();
      g.translate(32, 32);
      g.rotate(-0.6);
      g.strokeStyle = 'rgba(20,12,6,0.85)';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(-14, 0, 26, -1.1, 1.1);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-14 + 26 * Math.cos(-1.1), 26 * Math.sin(-1.1));
      g.lineTo(-14 + 26 * Math.cos(1.1), 26 * Math.sin(1.1));
      g.stroke();
      g.fillStyle = '#4e321e';
      g.beginPath();
      g.roundRect(9, -5, 5, 10, 2);
      g.fill();
      g.restore();
      break;
    }
    case 'shafts': {
      for (const off of [-8, -3, 2, 7]) {
        g.save();
        g.translate(32 + off, 34);
        g.rotate(-0.85);
        g.strokeStyle = 'rgba(20,12,6,0.8)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-20, 0);
        g.lineTo(20, 0);
        g.stroke();
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'meat': {
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(36, 34, 18, 7, 3);
      g.fill();
      outline(2);
      g.beginPath();
      g.arc(54, 33, 4, 0, Math.PI * 2);
      g.arc(54, 42, 4, 0, Math.PI * 2);
      g.fill();
      outline(2);
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(26, 36, 17, 13, -0.4, 0, Math.PI * 2);
      g.fill();
      outline();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.ellipse(21, 31, 6, 3.5, -0.4, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hammer': {
      g.save();
      g.translate(32, 34);
      g.rotate(-0.7);
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(-3, -14, 6, 36, 3);
      g.fill();
      outline(2.5);
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(-14, -24, 28, 12, 3);
      g.fill();
      outline(2.5);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(-11, -22, 10, 3);
      g.restore();
      break;
    }
    case 'knife': {
      g.save();
      g.translate(32, 34);
      g.rotate(-0.75);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(-3, -4);
      g.lineTo(-3, -28);
      g.quadraticCurveTo(6, -20, 4, -4);
      g.closePath();
      g.fill();
      outline(2.5);
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(-4, -4, 9, 22, 3);
      g.fill();
      outline(2.5);
      g.restore();
      break;
    }
    case 'net': {
      g.save();
      g.translate(32, 34);
      g.rotate(-0.6);
      g.strokeStyle = 'rgba(20,12,6,0.85)';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, 26);
      g.lineTo(0, -6);
      g.stroke();
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = 'rgba(201,180,138,0.35)';
      g.beginPath();
      g.ellipse(0, -16, 13, 12, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      for (let k = -10; k <= 10; k += 5) {
        g.beginPath();
        g.moveTo(k, -27);
        g.lineTo(k, -5);
        g.moveTo(-13, -16 + k);
        g.lineTo(13, -16 + k);
        g.stroke();
      }
      g.strokeStyle = 'rgba(20,12,6,0.85)';
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(0, -16, 13, 12, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      break;
    }
    case 'string': {
      g.strokeStyle = 'rgba(20,12,6,0.7)';
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(32, 32, 18, 14, 0.3, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(32, 32, 12, 9, 0.3, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case 'unbow': {
      g.save();
      g.translate(32, 32);
      g.rotate(-0.6);
      g.strokeStyle = 'rgba(20,12,6,0.85)';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(-14, 0, 26, -1.1, 1.1);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = '#4e321e';
      g.beginPath();
      g.roundRect(9, -5, 5, 10, 2);
      g.fill();
      g.restore();
      break;
    }
    case 'fish': {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(28, 34, 17, 9, -0.2, 0, Math.PI * 2);
      g.fill();
      outline();
      g.beginPath();
      g.moveTo(42, 30);
      g.lineTo(54, 22);
      g.lineTo(52, 40);
      g.closePath();
      g.fill();
      outline(2.5);
      g.fillStyle = accent;
      g.beginPath();
      g.ellipse(26, 37, 10, 3.5, -0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1a1a';
      g.beginPath();
      g.arc(17, 31, 2, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
