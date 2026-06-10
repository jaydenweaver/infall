/**
 * Gravitational lensing — Cartesian velocity-Verlet approach.
 *
 * Ported from steeltroops-ai/blackhole-simulation physics/shader logic:
 *
 *   • Ray marching in 3-D Cartesian space (y-up, equatorial plane = y=0)
 *   • Gravitational acceleration: a = -r̂ · k·M/r²
 *     k=3 chosen so the photon sphere sits at r=3M (matches Schwarzschild GR)
 *   • Velocity Verlet integration, v re-normalised each step
 *   • Disk sampled at every y=0 crossing; r_disk = √(x²+z²)
 *   • Tanner-Helland blackbody spectrum (exact copy from repo)
 *   • Hash-based starfield with B-V spectral classification + nebula glow
 *
 * No Boyer-Lindquist coordinates → no φ/θ pole singularity → no artifacts.
 */

export const LENS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const LENS_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform vec2  u_resolution;
  uniform float u_mass;
  uniform float u_r_inner;
  uniform float u_r_outer;
  uniform float u_r_horizon;
  uniform float u_cam_r;
  uniform float u_cam_theta;
  uniform float u_cam_phi;
  uniform vec3  u_cam_right;
  uniform vec3  u_cam_up_vec;
  uniform vec3  u_cam_forward;
  uniform float u_fov_tan;
  uniform float u_spin;
  uniform float u_frame;
  uniform vec3  u_cam_offset;

  varying vec2 vUv;

  // Disk tilt: 30° around the x-axis  (cos/sin precomputed)
  const float DISK_TC=0.866025;  // cos(30°)
  const float DISK_TS=0.500000;  // sin(30°)

  const int STEPS = 600;

  // ── ACES filmic tone-map ──────────────────────────────────────────────────
  vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}

  // ── Halton sub-pixel jitter ───────────────────────────────────────────────
  float halton(float n,float b){
    float f=1.0,r=0.0,i=n;
    for(int j=0;j<16;j++){if(i<0.5)break;f/=b;r+=f*mod(i,b);i=floor(i/b);}
    return r;
  }

  // ── Tanner-Helland blackbody (K → linear sRGB) ───────────────────────────
  // Direct port from the reference implementation.
  vec3 blackbody(float temp){
    temp=clamp(temp,1000.0,40000.0);
    float t=temp/100.0;
    float r,g,b;
    if(t<=66.0){
      r=1.0;
      g=clamp((99.4708025861*log(t)-161.1195681661)/255.0,0.0,1.0);
      b=t<=19.0?0.0:clamp((138.5177312231*log(t-10.0)-305.0447927307)/255.0,0.0,1.0);
    }else{
      r=clamp(329.698727446*pow(t-60.0,-0.1332047592)/255.0,0.0,1.0);
      g=clamp(288.1221695283*pow(t-60.0,-0.0755148492)/255.0,0.0,1.0);
      b=1.0;
    }
    return pow(vec3(r,g,b),vec3(2.2));   // sRGB → linear
  }

  // ── Hash / noise ──────────────────────────────────────────────────────────
  float hash3(vec3 p){p=fract(p*vec3(127.1,311.7,74.7));p+=dot(p,p.yxz+19.19);return fract(p.x*p.y*p.z);}
  float hash2(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p.yx+19.19);return fract(p.x*p.y);}
  float vnoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
               mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
  }
  float fbm(vec2 p){
    float v=0.0,a=0.5;
    for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.3+vec2(0.13,0.71);a*=0.5;}
    return v;
  }

  // 3-D noise — used for azimuthally-elongated disk turbulence
  float vnoise3(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(
      mix(mix(hash3(i),            hash3(i+vec3(1,0,0)),f.x),
          mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
          mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),
      f.z);
  }
  float fbm3(vec3 p){
    float v=0.0,a=0.5;
    for(int i=0;i<5;i++){v+=a*vnoise3(p);p=p*2.3+vec3(0.13,0.71,0.43);a*=0.5;}
    return v;
  }

  // ── Star spectral colour from B-V index (same classification as repo) ─────
  vec3 starColor(float bv){
    vec3 c;
    if(bv<0.0)       c=vec3(0.60,0.70,1.00);   // O/B  — blue
    else if(bv<0.3)  c=vec3(0.85,0.88,1.00);   // A    — blue-white
    else if(bv<0.6)  c=vec3(1.00,0.96,0.90);   // F    — white
    else if(bv<1.0)  c=vec3(1.00,0.85,0.60);   // G/K  — yellow-orange
    else             c=vec3(1.00,0.60,0.40);    // M    — red
    // Tint toward purple
    return mix(c, vec3(0.75,0.45,1.00), 0.30);
  }

  // ── Procedural starfield ──────────────────────────────────────────────────
  // Cube-face projection: dominant axis → 2-D face UV → uniform angular density
  // → round Gaussian PSF stars; no square grid artifacts.
  vec3 starField(vec3 dir){
    dir=normalize(dir);
    vec3 col=vec3(0.012,0.005,0.025);  // purple ambient

    // ── Milky Way band ────────────────────────────────────────────────────
    {vec3 gp=normalize(vec3(0.187,0.934,0.302));
     float band=1.0-abs(dot(dir,gp));
     float mw=pow(band,3.5)*fbm(dir.xy*3.0+dir.z*1.5)*0.35;
     col+=vec3(0.55,0.62,0.90)*mw;}

    // ── Nebulae ───────────────────────────────────────────────────────────
    {float e=fbm3(dir*2.7+vec3(3.1,0.7,1.4))*fbm3(dir*1.3+vec3(0.2,2.8,0.6));
     if(e>0.28)col+=vec3(0.90,0.12,0.18)*pow(e-0.28,1.8)*0.5;   // H-alpha red
     float rf=fbm3(dir*2.1+vec3(1.5,3.3,0.9))*fbm3(dir*0.9+vec3(2.2,0.4,3.7));
     if(rf>0.30)col+=vec3(0.18,0.35,0.90)*pow(rf-0.30,2.0)*0.3; // reflection blue
     float o=fbm3(dir*3.5+vec3(0.8,1.6,3.0))*fbm3(dir*1.7+vec3(3.4,2.1,0.5));
     if(o>0.32)col+=vec3(0.10,0.80,0.75)*pow(o-0.32,2.2)*0.2;}  // OIII teal

    // ── Cube-face UV ──────────────────────────────────────────────────────
    vec3 ad=abs(dir);
    vec2 uv;float face;float adm;
    if(ad.x>=ad.y&&ad.x>=ad.z){uv=dir.yz/ad.x;face=sign(dir.x);adm=ad.x;}
    else if(ad.y>=ad.z)        {uv=dir.xz/ad.y;face=sign(dir.y)+2.0;adm=ad.y;}
    else                       {uv=dir.xy/ad.z;face=sign(dir.z)+5.0;adm=ad.z;}

    // Layer A — bright/rare stars
    {float G=28.0;vec2 gc=floor(uv*G);
     for(int dx=0;dx<3;dx++)for(int dy=0;dy<3;dy++){
       vec2 nc=gc+vec2(float(dx)-1.0,float(dy)-1.0);
       float n=hash2(nc*31.7+vec2(face*17.3,face*91.1));
       if(n>0.995){
         vec2 sp=nc+vec2(hash2(nc+7.3),hash2(nc+13.7));
         vec2 dv=uv*G-sp;
         float bv=hash2(nc+41.1)*2.4-0.4;
         float sz=(0.05+hash2(nc+99.0)*0.01)/adm;
         float g=exp(-dot(dv,dv)/(sz*sz));
         float bri=0.6+hash2(nc+123.0)*1.4;
         float tw=0.85+0.15*sin(u_frame*0.05*(3.0+hash2(nc+73.7)*2.0));
         float szH=sz*6.0;
         float gH=exp(-dot(dv,dv)/(szH*szH));
         col+=starColor(bv)*bri*(g+gH*0.04)*tw;}}}

    // Layer B — faint/numerous stars
    {float G=68.0;vec2 gc=floor(uv*G);
     for(int dx=0;dx<3;dx++)for(int dy=0;dy<3;dy++){
       vec2 nc=gc+vec2(float(dx)-1.0,float(dy)-1.0);
       float n=hash2(nc*53.1+vec2(face*29.7,face*67.3));
       if(n>0.99){
         vec2 sp=nc+vec2(hash2(nc+17.1),hash2(nc+23.9));
         vec2 dv=uv*G-sp;
         float bv=hash2(nc+55.3)*2.4-0.4;
         float sz=(0.13+hash2(nc+83.0)*0.01)/adm;
         float g=exp(-dot(dv,dv)/(sz*sz));
         float bri=0.15+hash2(nc+144.0)*0.35;
         col+=starColor(bv)*bri*g;}}}

    return clamp(col,0.0,6.0);
  }

  // ── Accretion disk colour at an equatorial crossing ───────────────────────
  vec3 diskColor(vec3 hit, float imgOrder){
    float rInner=u_r_inner*u_mass;
    float rOuter=u_r_outer*u_mass;
    vec3  d_ax2=vec3(0.0,-DISK_TS,DISK_TC);
    float r_disk=length(vec2(hit.x,dot(hit,d_ax2)));
    if(r_disk<rInner||r_disk>rOuter) return vec3(0.0);

    float pageThorn=max(0.0,1.0-sqrt(rInner/r_disk));
    float temp=1.2e5*pow(rInner/r_disk,1.5)*sqrt(pageThorn);

    float phi_d=atan(dot(hit,d_ax2),hit.x);
    vec3  orb=normalize(-sin(phi_d)*vec3(1.0,0.0,0.0)+cos(phi_d)*d_ax2);
    float v_kep=clamp(sqrt(u_mass/max(r_disk,0.1)),0.0,0.9);
    float st=sin(u_cam_theta),ct=cos(u_cam_theta),sp=sin(u_cam_phi),cp=cos(u_cam_phi);
    vec3  camP=vec3(u_cam_r*st*cp,u_cam_r*ct,u_cam_r*st*sp);
    float beta=v_kep*dot(orb,normalize(camP-hit));
    float gam=1.0/sqrt(max(1.0-v_kep*v_kep,1e-6));
    float doppler=clamp(1.0/(gam*(1.0-beta)),0.05,8.0);
    temp*=doppler;
    float beaming=pow(doppler,3.0);

    float logR=log(max(r_disk/rInner,0.001));
    vec3 noiseCoord=vec3(hit.x/r_disk*1.5,logR*7.0,hit.z/r_disk*1.5);
    float turb=0.35+0.65*fbm3(noiseCoord);

    float fade=1.0-smoothstep(0.6,1.0,(r_disk-rInner)/(rOuter-rInner));
    float dim=imgOrder<0.5?1.0:0.30;

    return blackbody(temp)*turb*fade*pageThorn*4.0*dim*beaming;
  }

  // ─────────────────────────────────────────────────────────────────────────
  void main(){
    float aspect=u_resolution.x/u_resolution.y;

    // Sub-pixel Halton jitter
    float fn=mod(u_frame,16.0)+1.0;
    vec2 jitter=vec2(halton(fn,2.0)-0.5,halton(fn,3.0)-0.5)/u_resolution*2.0;
    vec2 ndc=vUv*2.0-1.0+jitter;
    vec2 ndc0=vUv*2.0-1.0;          // non-jittered — used for stable starfield

    // ── Camera position in Cartesian geometric units (y-up) ──────────────
    float sinT=sin(u_cam_theta),cosT=cos(u_cam_theta);
    float sinP=sin(u_cam_phi),  cosP=cos(u_cam_phi);
    vec3 p=vec3(u_cam_r*sinT*cosP, u_cam_r*cosT, u_cam_r*sinT*sinP)+u_cam_offset;

    // ── Ray direction from camera basis ───────────────────────────────────
    vec3 v=normalize(
      u_cam_forward
      +ndc.x*u_fov_tan*aspect*u_cam_right
      +ndc.y*u_fov_tan*u_cam_up_vec
    );
    vec3 v_init=v;   // save jittered initial direction
    // Non-jittered initial direction for starfield
    vec3 v0=normalize(
      u_cam_forward
      +ndc0.x*u_fov_tan*aspect*u_cam_right
      +ndc0.y*u_fov_tan*u_cam_up_vec
    );

    vec3  diskAccum=vec3(0.0);
    float diskAlpha=0.0;
    int   crossings=0;
    float imgOrder =0.0;

    for(int i=0;i<STEPS;i++){
      float r=length(p);

      // Absorbed by event horizon
      if(r<u_r_horizon+0.05){
        gl_FragColor=vec4(aces(diskAccum),1.0);
        return;
      }

      // Escaped to background
      if(r>200.0) break;

      vec3 p_prev=p;

      // Adaptive step: finer near BH
      float dt=clamp((r-2.0*u_mass)*0.08, 0.02, 1.5);

      // Gravitational acceleration.
      // Factor k=3: circular null orbit at r=kM=3M (Schwarzschild photon sphere).
      vec3 accel=-normalize(p)*(3.0*u_mass/(r*r));

      // Gravitomagnetic (Lense-Thirring) frame-dragging: a_drag = v × B_g
      // B_g = (2/r³)(3(J·r̂)r̂ − J),  J = a·M ŷ  (spin axis = y)
      {float a=u_spin*u_mass;
       vec3 J=vec3(0.0,a,0.0);
       vec3 rhat=normalize(p);
       vec3 Bg=(2.0/(r*r*r))*(3.0*dot(J,rhat)*rhat-J);
       accel+=cross(v,Bg);}

      // Velocity Verlet
      p+=v*dt+0.5*accel*dt*dt;

      float r2=length(p);
      vec3 accel2=-normalize(p)*(3.0*u_mass/(r2*r2));
      // Frame-drag at new position
      {float a=u_spin*u_mass;
       vec3 J=vec3(0.0,a,0.0);
       vec3 rhat2=normalize(p);
       vec3 Bg2=(2.0/(r2*r2*r2))*(3.0*dot(J,rhat2)*rhat2-J);
       accel2+=cross(v,Bg2);}
      v+=0.5*(accel+accel2)*dt;
      v=normalize(v);   // keep unit direction (null-ray constraint)

      // ── Tilted disk plane crossing → sample disk ──────────────────────
      float dN_prev=DISK_TC*p_prev.y+DISK_TS*p_prev.z;
      float dN     =DISK_TC*p.y     +DISK_TS*p.z;
      if(crossings<3&&dN_prev*dN<0.0){
        float t=abs(dN_prev)/(abs(dN_prev)+abs(dN));
        vec3  hp=mix(p_prev,p,t);
        vec3  col=diskColor(hp,imgOrder);
        float bri=length(col);
        if(bri>1e-5){
          float w=1.0-diskAlpha;
          diskAccum+=col*w;
          diskAlpha=min(diskAlpha+min(bri,0.9)*w,0.99);}
        imgOrder+=1.0;
        crossings++;}
    }

    // Lensing deflection on non-jittered ray → stable star sampling
    vec3 v_stars=normalize(v0+(v-v_init));
    gl_FragColor=vec4(aces(starField(v_stars)*0.25+diskAccum),1.0);
  }
`;

// ── TypeScript API (unchanged — SimCanvas.tsx requires no modification) ───

export interface LensingUniformData {
  mass:        number;
  spin:        number;
  cam_r:       number;
  cam_theta:   number;
  cam_phi:     number;
  cam_right:   [number, number, number];
  cam_up_vec:  [number, number, number];
  cam_forward: [number, number, number];
  cam_offset:  [number, number, number];
  resolution:  [number, number];
}

export type LensingUniforms = Record<string, { value: unknown }>;

export function createLensingUniforms(
  data:     LensingUniformData,
  rInnerM   = 6.0,
  rOuterM   = 15.0,
  rHorizonM = 2.0,
): LensingUniforms {
  return {
    tDiffuse:      { value: null },
    u_resolution:  { value: data.resolution },
    u_mass:        { value: data.mass },
    u_r_inner:     { value: rInnerM },
    u_r_outer:     { value: rOuterM },
    u_r_horizon:   { value: rHorizonM },
    u_cam_r:       { value: data.cam_r },
    u_cam_theta:   { value: data.cam_theta },
    u_cam_phi:     { value: data.cam_phi },
    u_cam_right:   { value: data.cam_right },
    u_cam_up_vec:  { value: data.cam_up_vec },
    u_cam_forward: { value: data.cam_forward },
    u_cam_offset:  { value: data.cam_offset },
    u_fov_tan:     { value: 1.0 },
    u_spin:        { value: data.spin },
    u_frame:       { value: 0.0 },
  };
}

export function updateLensingUniforms(
  uniforms: LensingUniforms,
  data:     LensingUniformData,
): void {
  uniforms.u_mass.value        = data.mass;
  uniforms.u_spin.value        = data.spin;
  const a = data.spin * data.mass;
  uniforms.u_r_horizon.value   = data.mass + Math.sqrt(Math.max(data.mass * data.mass - a * a, 0));
  uniforms.u_cam_r.value       = data.cam_r;
  uniforms.u_cam_theta.value   = data.cam_theta;
  uniforms.u_cam_phi.value     = data.cam_phi;
  uniforms.u_cam_right.value   = data.cam_right;
  uniforms.u_cam_up_vec.value  = data.cam_up_vec;
  uniforms.u_cam_forward.value = data.cam_forward;
  uniforms.u_cam_offset.value  = data.cam_offset;
  uniforms.u_resolution.value  = data.resolution;
}
