// Temporary original melody. Replace BACKGROUND_TRACK.url with a supplied song file.
export const BACKGROUND_TRACK = { url: null, title: '轻快练习曲（临时）' };
const melody = [72,76,79,76,74,77,81,77,76,79,84,79,74,77,79,0,
  72,76,79,84,81,79,77,74,76,79,77,74,72,0,72,0];
export class GameAudio {
  constructor({muted=false, onMute=()=>{}, contextFactory=()=>new (window.AudioContext||window.webkitAudioContext)()}={}) {
    this.muted=muted;this.onMute=onMute;this.contextFactory=contextFactory;
    this.active=false;this.voices=new Set();this.beat=0;this.timer=null;
  }
  unlock() {
    try {
      if(!this.ctx){this.ctx=this.contextFactory();this.master=this.ctx.createGain();this.master.connect(this.ctx.destination);this.master.gain.value=this.muted?0:1;}
      this.ctx.resume().catch(()=>{});
      if(BACKGROUND_TRACK.url&&!this.track){this.track=new Audio(BACKGROUND_TRACK.url);this.track.loop=true;this.track.volume=.28;}
      this.sync();
    } catch { /* Silent devices and unavailable audio must not interrupt gameplay. */ }
  }
  setMuted(value){this.muted=Boolean(value);if(this.master)this.master.gain.value=this.muted?0:1;this.onMute(this.muted);this.sync();}
  setActive(value){value=Boolean(value);if(this.active===value)return;this.active=value;this.sync();}
  stopVoices(){for(const osc of this.voices){try{osc.stop();}catch{}}this.voices.clear();}
  sync(){
    const play=this.active&&!this.muted&&this.ctx;
    if(!play){if(this.timer)clearInterval(this.timer);this.timer=null;this.stopVoices();this.track?.pause();return;}
    if(this.track){this.track.play().catch(()=>{});return;}
    if(this.timer)return;
    this.next=this.ctx.currentTime+.03;
    const schedule=()=>{while(this.next<this.ctx.currentTime+.14){const note=melody[this.beat%melody.length];if(note)this.tone(440*2**((note-69)/12),this.next,.20,.035,'sine');if(this.beat%4===0)this.tone(130.81*(this.beat%16>=8?1.333:1),this.next,.35,.018,'triangle');this.beat++;this.next+=.25;}};
    schedule();this.timer=setInterval(schedule,40);
  }
  tone(freq,at,length,volume,type='sine',end=freq){
    if(!this.ctx||this.muted)return;
    const osc=this.ctx.createOscillator(),gain=this.ctx.createGain();osc.type=type;
    osc.frequency.setValueAtTime(freq,at);osc.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+length);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+length);
    osc.connect(gain);gain.connect(this.master);this.voices.add(osc);
    osc.onended=()=>{this.voices.delete(osc);osc.disconnect();gain.disconnect();};osc.start(at);osc.stop(at+length+.01);
  }
  effect(kind){
    if(this.muted||!this.ctx)return;const at=this.ctx.currentTime;
    if(kind==='jump')this.tone(420,at,.12,.065,'sine',820);
    else if(kind==='dash')this.tone(220,at,.16,.05,'triangle',700);
    else if(kind==='hurt')this.tone(220,at,.19,.055,'triangle',65);
    else if(kind==='end'){this.tone(330,at,.2,.045,'sine',220);this.tone(220,at+.16,.3,.035,'sine',110);}
    else if(kind==='heart'||kind==='sword')for(let i=0;i<3;i++)this.tone([660,830,990][i],at+i*.07,.13,.045);
    else this.tone(650,at,.045,.022);
  }
}
