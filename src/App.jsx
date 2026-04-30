import React, { useState, useRef, useCallback } from "react";
// ── ERROR BOUNDARY — muestra el error en pantalla en lugar de pantalla blanca ──
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:24,background:"#0D1619",minHeight:"100vh",color:"#fff",fontFamily:"monospace"}}>
          <div style={{background:"#DC2626",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:14,fontWeight:700}}>
            ⚠ Error en CAMPO
          </div>
          <div style={{background:"#141E22",borderRadius:8,padding:16,fontSize:12,lineHeight:1.6,wordBreak:"break-all"}}>
            <b>{this.state.error.toString()}</b>
            <pre style={{marginTop:12,fontSize:11,opacity:0.7,overflow:"auto"}}>
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}



// ── PALETA FOSMON ──────────────────────────────────────────────────────────
const C = {
  bg:"#0D1619", surface:"#141E22", card:"#1A252A",
  border:"rgba(255,254,249,0.10)", borderM:"rgba(255,254,249,0.20)",
  caliza:"#FFFEF9", textPri:"#FFFEF9",
  textSec:"rgba(255,254,249,0.55)", textMut:"rgba(255,254,249,0.30)",
  green:"#16A34A", red:"#DC2626", blue:"#2563EB", yellow:"#CA8A04",
  purple:"#7C3AED", orange:"#D97706", pink:"#F43F5E", indigo:"#6366F1",
};

// ── EMBLEMA FOSMON ─────────────────────────────────────────────────────────
const EMB_WHITE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAN8AAAECCAYAAAB+LgJpAAA2lklEQVR42u29e7ycVX3v//6u55mZHQgIigWU4hVrRcVKvRQQwz0JJCEQIgpoOT21v3p+tfZobU+rIl6qrbanp/Vle3pOES9cJIGQQLgJBqwiUlC5CAhWUbSAIHey57ms9Tl/PM/sPXsyO9d9mdlZn9crrySzn5m993zmvb5rre96vl+IGihJMklOUjrh8bPOclL+Jvnsk/LFA1JxdH39LvLt70j+EqlYKGmXntdLJSWSLL67UVGTQ5f2eew1Ktt/Lp99Sz7PNKbRBdU1P5snn/1AkuTbXj77D8n/jYriaEnz+oDoIohREbgauF4YpOy1Kjf+hVTcJJ+V48Dlkm9nkoI0esQ4fO07JZXyba9u+fZPJf9ZSUdLakUQoyJwfYHTvlL7fVL5Tfm86AGuqKJaO8i3axg3gU9d1xQK7S4Kg+Sze6TsryQdIqkZQYza2YBzPY+/QGX7vfLleil/ZlLgQqaxP1uCb+K1fUAsgnx2t3z2V5J+R1Ijgjg7SuNbMH3AAQkQzCwAZf343lCsgGQRoVhA0tp17Ekh8yADM8x23BszG/M4ZAEImKW45iuB/wHlnwN3qWyvImmtA243s7IbRCAAMjNFVyN8gw6cqz+s3cA9H/JlkB5LyBbiWrsB4EINXPU/zBKYpoBj5gCHEMo0BqI1DyRJDyQUH8Zxm5SvhcZlEcQI3zAC56vHn9oLWifWwB2Ha+1eIZb2AW4GZVSRtRdE51JovB54PaH4CM6+L7XXgF1q1vpBPxDr3zcqwjcIwD2xJ8xbREgXE4rFuOaeAwHc1oAYgqAbxPRgSA8m5GdJxc3g15HbemuNg9g1tfYxGkb4ZgI4zMyPA6c9wC8CW1gDt1d1VWMwgdv8+rAfiA1ID4X0UNL8E1LxHfDrgPVmdlfX1DqCGOGbEeB2g/Jo0ImEvAIOwDWqjQ1JmA0+cFsNYltgHRAPg/QwQv5J+fJKXLgGGheb2UMRxAjfVABngKunVzVwj+wGexwFOp6QLcK1Xti1aRLqzYikhm7uvCFmE6emagvrgJgsrf7kn5bPv478NSQjq83s4S4QXT2ARRAjfJMBt8rBKVYDJyBU5yTLYyvgwiJcWgMnCJlqMJOxncS5LjOro2JnahrqNe18XLIUGksJ+afly+twfi0015nZr+qBKYIY4dtShFMLeCOUiwn5Kbjmy+pVWy9wtlMPXtXvX02rQykox0EkWQbJMkL+hOSvxOdfI8n7gWhUu6aK8O18wHUiXIuieCMNLSbkK3DJyyGtgWsLLAK3rSAKI2nsAe7tJCNvJ9gTUnElPlxF8uxaM3uyy5edEsR0J4HO9QEuBQ4itJdDsZLUHQBJnUDIQWUJOMy5CNx2gGhAKAQKYIbrgMjbCTws+StAV8FTV/eA2NmkmvMgpjvJ5yGMAVcUB9HQEiiWgx2IG6nNziHUwDkzsAjc1GzW1BGxG8Tm3mBnAmfCrg9LxRVVRGxeaWZPx8g3d6aZCXl+IE2dSChOIrEDodEFXFYB132eMu7JTTOIeWft7MZATDiTkD0oZevArYf062b2bIRvOMFLzMyrbP8RzdbfAGm1H1n0By5qpqemaR8Q9wX7A+APIN8g6TgzKyTZXJyCzuUPXpVsS/R8ICVkGdCIwA08iAWu1SCwD460Gi13aObT/a0U4ZtRuaKeSKZ1Pi5qkEGsNsIMVGzvAqDaYLvedR8G78yGGD+PG+GboQgYbwwd1pnLdoA3tsGGDDFSfymrjwh2XzO7YSF6HDWH1vnOzILaT71Syv4en9+J8o1QbCTkP5L8v0j5m80sCNls360f4YuaA9BhY+Cp/WFa8++G5h+DRpDOJ4Qvg54C9/vQ+LZ8+58QqZlpNgGMGw9RcwE/M7MgP/oZaH0A/J3g32XJyHcnQpr/DtjncK3/j5A/T9LpQFndhDLzmzERvqhhn2rWKaXsHbjmB6C4B546FHZ7sZT9V3wYAYwkfcCscan0xNGEkStxrVPw2Y2Wjvx9fdqpjPBFRW2bQrWlFv6y+q+9x2yvp+Tb5+BaB0P2OMY8SEfk27dD67dx+bvB/zvGn0s6x8yemo1cYlzzRQ1z1HNmJoX8EFzzVZDfbNbcUK/jPCF/jOTxX8e1noPPvolrvRayRWat26G8EdfaG8q3VK+2asZZiPBFDbPqz69eDg6Cv0UKnQgmUBOeewAUr8HcnoTyYbCfVHC6qwHh/W9Wr3HKjG+8xGln1FxQikRVVmBMBa41n5DdjGs2KkxHzzDb5Y4qauaPAQahOcsjR1TUUOvpunTHc7rWbSkha+OS5ZD9BaEMBPdeSSNV5PMHVtHRHo/wRUVtu+pIpzugLMGOlfSc+v7NJlgG6RVmI58Cfzeu9Qayp19aAZocDRiJu3Hia0X4oqK2qCqpLjMbuQfKq6rbk7J310fH8vp86PMkJTguglDSar1OxbMroPEqQvsWrr/xB/VOZ4QvKmpbGaz/ej/4JyA9W0X7eFzrWFzrQDN71My82cjHoP0i8Clp6/8SSo9L3m9HHFHOFgcRvqi5EP2c2ci94P8bkJK2Lidkn4PiZZJ2rf5kv0VI/5iQfgHcc3D+VLPmNzpJ+tn42eNuZ9QcAXBDatY6X/mz95K0/gHXeifwzuo+XVVLQAcQfgjZH5nN+5qktPe2owhfVNQ2A3hEWSfdbwEOkfK34sMCjP2BBOcegHAzpFeZzSvqiFfO5s8c4Yuag1NQC2bNG4Ab+l03m1PNuOaLmusAmqREUqP6+6Kuf8sGAbwY+YZNolNsCChtwleqU/nxjn3GarX48fcKev5NhC9qK6FT9WEyS7FWfRwqqT9MXmAtIMU5CMEDFuvVDL6iQYMMnORRCLim4Vop5gL4DVD8ATx9a3XhizOcew+U5xH0JK6V4Fqufo2yBjdqABUj3+BBV7Ubq9o0d4r7PkQI5+GS1WaNm/pMsa4FrpW0DxRvB3cqlrwRS1IQhLyKks4cilPTGPmi+kU54VoO10oJFAR/JeTv4snRV1ky7wNmzZvqy9Oepyf1Lt9DZs3/yapLDqEICyD/X4T80ToaJgiL0TBGvqgJUS5JIe30NLgfp/Nwza+a2R1dgKVUzUNCb36qqySeAZ381Q3ADZI+gS9WkCQrkB2Ja9YFatsBTGCu6s0eFSPfThPlNB7lCBshXEJZnohrvMqs9SEzu0OSacOGtN4eL7d0+NfMZGZltdV+UVLnsx61tPnPZsnReA4jtD9LyH+OG3FVRLRONAzRnBj55nKUEy5NIKnXcuXdeH8hSesLZvZAvyjHdhT26dpqnxANrdm8EbhR0ifBLwNOATsW12rU0bDqvQ6uLuMeFeEb4igHHiMd24EM+VM4Ww/uXEivt7SRd0Hiauim7NhTDeKE/uhm9gTwReCLkl5LaK/EpStxIwcACZQQfN2fMKYsInzDIkOEegrnGgm4tLpP09+KLy8gaZ1nZg/1RDnfHa2m7Ucb71NocH0CC7yZ3Q7cLv3kE5T7LsKlp4NfiGvtUg0Wmah+gRgNI3wDHuWwFNeqN0+yx8DOxzUvAb5haeq7IpBNdZTbwWjYBtYAayTtD8WZYKfgWgdW0dBDKGMCP8I3KMBRd1sFXDMBSwmlkP8GLlyEK1ab7fbLPlFuYDY3JkbDsWnvz4CzJX0KyiPBnYEvTyBp7V79IhmIkvE+9VHboTiCbe/miVTizMZyaKF4kJD/LS49zJJ0gVnz82a7/bLOwSVdO5YDmWOrd0q9mUlnneXqe91ys8ZVZslpJOUrIfsg+FuwFFwrxTWs3rn19bnTqG1aoczdWWBabbtnH4PmhwmZx+q2xNs/rQyAjW2eVEV7rgW/iidHL7U99nhskrXcsL6HnWg41tOu7nF3GJSnEPw7cK09q4vz6jjbjkZDKeBajpDdgWu90czasTPtzhzlehPhFD8m+ItwIxeZ2ffGL92QwoK+ifChHJknSVkwnsD/OL69nKTxNswdjqX1cbasTuDHTZoI3/ZHOVdHOUfIR3HhagjnQeNyS5rt7g9lHeXKufqWdDZpuqIhZvYw8M/AP0v5myFfSeBU3Mi+9SAFIcSURYRvW6Jcmo4lwkNxF2g1rnmumf2kZ1q53YnwuRYN63OnN0mPfwxYCslpYIfjWlVn2JjAj/BNEuW6E+GOkD2NsysgfBnX+JqZTWsifNijYf3euOohewL4EvAltdsH0Ahn4uxU3MhLiAn8nYaptPo7+5gkybdLhUwKmaQsyI96+XYpeVUKkspvS/l/l7Rf72vVH66ordik6ZxHHX/sZ/Ok4iSpXCvf3qiOfDvIt0v5dhjzxrd9/bXbJY10DXpRQw1fZXZRATj2AXhM8p+TiqOks1zX810nRRDfze32wFWbUN2Pjb5Yyj8sFXeNm1BKvl3It32Eb+7BV8q3syq6SfJFkMpvSPl7pGf27RPlotlTHQ17BjJJTUmLpOJ8+fbT44PhqJdUyLdvi/ANP3wf74pyD0vZ/5LyQ3uuTWKUm81ouHF/le33yRffUShqr7K7InxDa3JlsMr2h6Tyeil7l/TEc2OUG7hoOHGqXxRHSP5f5LMbInzDb/JInygXN08GD8SeaPiLXSJ0Qz6adgEXo9zw+NfsN1WN/g3sOmKTokLWbx0Yo94wRb++Hia13xHEAVszNKRypdR+f30AGJWj75HK/zJx+mlxvTdYHtqEAbJoL1LZ/qCk+QAq2suk9h9LD+4a1+wDF+WyV1cbK/md9a7mzWNf89nq+rH/kM8+I+Vv6DuSxlLrM+vhhj47nmr/hXx+W73b+VM9/HAFnx/9m2oLNHtAyv5Jef7GnkE3RsMZnpLsIpXvkC9XS0U2fkpFXr59zTh87XMkeanewlZRSuXXpOz39dRTz48j6axGuRFJSyS/Wj57ZjzpriCff3cMPrU/UmXi824Pb5Ly/yY9sWdcWkyPWa4zfeyKcq+Tz86Wz3487lXeOSGR11Huui74vlg/lsm3C6n7dEv2sHz291J+uLoqOce835TPVHo81Muk7JNSft+4GUXHw2LshMsYfNlH68fyPh7+St6fI+Vv6R6g4wmlqYpyjz66u8rs96Tya/J50ZU09xPOBvp2uRn4qmNlPuucJyzHTryEUvLlN6X8j+KJl2mbqcyTspWSv1w+H530fGf38bJN4ev2cOLZ3FBIKm+t1vujL47RcNunJMn4Y2c5SW+Sb39evv1gnyjnxw7jjh/K3TJ8E6/f9Kynssel4vNScUwcSbfVx4uSTaNcfrCUfUbK7u8T5fp5uGX4tuzhM1LxJalYJt3bGlQP01mGrlM5q2T8HrHn1M0+3kko31Td5iMIWV1WzxxmU/NzV/eVTSyf7hp7gPtD0B8SyttUti8gaX3FzH4x/nOP37Eegeu+p29lx8Pn4fPlJOmpBL+gKi5FfYc7nTvcp8HDrHM/5q6QnAGcQXjJ3Srb55Gwxszu6o6GjN+PuXPA16cuSJBuacBBR4BWErLluFZ1DMxyCFmnLkgyrT+YubqobdG5WTTBtQ6C9CBC/iGpvBL0FUivNrOs53cJc7HGyDZ42Lmn73DIVxCyt5G0fg0AV3Y8nP7796rXd4RSUHpQghv5TUg/QSg+IhWX4sMakualdanE6vfZsCFlwYIZr7eTzqBhfaLc6EvBlkH6TnCvAwMXOlHOwGzKRsjtHkkt4JL5kJwCnEIo7pOyCyF8ob6z3e8s0bCnjksnyu0NxQqCexv4t0AT3DTNVLbZQ+uKhq4J6UoSVkL+Iyk7H7jErHWbHXFEZ/BIugaU4Yavf5RTC8pjwa0klCfhmt2Vkf2MRLntG0k7NV0OAD4MxQck/zUIX4L0SjPb2P0BZcgrl20uylVTtvJIcKcTsuNxredWV+SgshxMD4Mg61SfeznwESj/h3x5A86fB81VZvZsz7R0Wj1Mp8mwTkkBPz5Ctl+J50Qo3wXpK6spieudkgxmWYtqJE0mriuSeeCWgltKyB+QH70AN7LKzG7pmobN6Eg6A+vx/SA7g1C+DZccVM1UGlWUkwznZj7K7ZCHroFLj4bkaEL+CalYS6Ev0mj+e6dMSNcG0pQvLdKpHiHrwqt1jcdf7AJ7nwCsgLCUpNEaj3IKszIlmbKR1At8ZyT9deCDhPL98uXXcf4CnmqvM7NfzeRIOoVRLvTMVI4D9446ys2vrsgA+drDhGGqibRJNJThWi8Eew+N8g8I5U1S+Ao8c4GZPTldmzTpjpmFgWzTKJe9hsC7CFqBS15UDxw9UW5ApiVTM5JWU2ZnKTSPgeQY5vOI/Oj5VSvn5je7RtLuPg0aEOj6RbmXQH4mFCuh8RvVTCUFn3ms069hrnhoEPJxD13zUEgOJezycSm/BGwVpBum2sN0B0bIeuFdfXNJu4BfAfZOgj8c12h0hfip3V4eTBNTAp11Bbjm88H+GMr3SuU3IVwAjdVm9sggRMOetWknyu2Gz5eSpCsgPw6a8yoPu8r+uSEHbqs8bKtKOzX3Ans3hHeDv1XKzwN/6WZKSE4PfD3FUj3jBVRfD+XvEfKluOYLqw+en7nt5YEyEBuLBp2R1CzFmm+B5C2E/GOSXw/hy3DbN8ysmOlo2BPl6pE8fwNBJ0PxdpLm/tWV3etx58ai/E7hobMJHkKKax0MycGE8HHJrwZ3Mffdd01X2mmbPXRbNmusaUankYaXHt1dyt8N/puE8juQ/iGu+UJCOxAyTwiqPnQ7cV1G60qTdN4Xl+4F7l2QXEs46BYp/6D07Avq8vJVkxIp7a6iNlVRrnNap1PKXtLzpPJMyV8J9m1c88+gsT8hqz300cOOh1anLEJWVgl89y5gHS978XfrW58OmOjhhq06zpZuIcrVO3VnB+miBJYvAHcqoVyGa1R3BLjuRLiL5+f6mrhJAj/FtV4LvJagv5SKqyj5Mml6zSQFerU9wNE/EX4Y5CdD/g5oVolw6kS4lOCih5vfpOkk8ElwrVcBf13PaNaA1kBymZmNbo2H6ZYX3htfBOlycO8AewO48e1lVIXoubqWm651Rfda2KW7Q7KSlJWE4m6p/VVonWtmP+3a/NjqdUX/RPgz+0DzJIJbCeXh0LS+R/ZiFfft8TDgkha4U4FTofixlK2G5hfr42wdDzdJO6WTJMKbUC4CdzKhXI5rzK+cndAUMYn3n+7wSEpPAv83gY8Ssj+T/DX48qskzXWd5O9kCfzNJMLfAu4MQnkirrHneCI8G6xE+NBHwwlpp5cCHyQU75PKG/D+SyTNSzqHMLo32tKJjS/aB4BbTijPwKWvrqaVycTNE4v9HaZhJO2XwF9G0lwG+f1Sdj6FXWJmt9KnKUtP85J98dlp4E8De101U0nHo1yVk4seTruHrgnJMSTJMYT8r+Xbaynt/1ir9b1OyiKVNA/8kuqMZXkSNEaqWWpbiFABF82axZH0xcBfkBR/Jl9ejfOXwOgaswmNOFv1ca/fJWSLSFq7jc9UyhjlZsXDCcfZXgD8IWn5+1J5E/hzoXlRSsjvxDVfOrb52b29bETDBmYktRSSxfWfT0jPLDSbf5uk5xLy9bjmmysL0/GD6XGmMige1gl8l0J6GCSHEfJPp7jmSyuDpaE87rXTjKRjCXyPa+0DSb1TyXzgFRBEKEtQGqPcgG7SBHUfwtgrJWShPioU36SBNrBO4Ks6UNS19gtABvVIGxtPDr6HACFXbFA4rDZOHC0jcEMYDSN4UVGzpAhfVFSELyoqwhcVFRXhi4qK8EVFRUX4oqIifFFRURG+qKgIX1RUVIQvKirCFxUVFeGLiorwRUVF+OJbEBUV4YuKivBFRUVF+LZVnfIK2vSx2D99yDzs9avfY0Ot4S+WJNU1K5Xg0s7vM9J1RRNIq0acvrv7bSy9MFAeKoAZLu0Uf9q1Kr83FiRSXAoqO4Wbh74ESjr8wLUMOg1J8odxXIJLVtVVnIHifxKyx8FOwLX2Z7zUdwRxYIBruKo6MxDyh3DJFTguZZ99Risf21+CcldCOAHXeAXmKg8nVlAfOg9N1YdwWIALSEbSdGMz5pA/jEvXUBbXkrauNrNnJnn6rpTZUaQcD7YImr8+9sVObcxhMFHyuFYC7aPM5n1d0n6E/N9xjX0IRcAGeCnR8RA6wHU8fByXXgG6CpJ1ZvZU/6f/ZARe/GZCewm4JbjGAWO1o4ZwMB1s+MbNopqOJJ03+le41irIruPRp6+25z//6a6nJDDWQ7C3P/w4iJRHgY4naDGuud/YciPkgw3isME3qYf547j0StA18MxlPRW4ez3sbv4yDmK532GkLCGEk8Y9HB4QBw++yc16Apdeh8+vIBlZb2YP95rFZtpp9WnuWT/+yG743ReTuIWEsBjXaZsVIBTdxYQtwreDHpI/Dem1UK6D0XU9wDm43sECv2UPrzezI7pA1C5QLgAWEsLyYRlMBwO+CWYlydhSNGRP4tLrwK/n2eJKmz//wW0BbjPfbhIQ9RzIF0K6kFBOBNEXARtrb20Rvkk9VFUWvdEZNJ/BJddCuAYaF5vZLycCh2M7WmNvxsNdoDwC3PGE8iRcc+9BBXH24JscuI24xgYo10JxudkE4Pq2yNrBH6O3vVbn8T0gPx7cCRAWQnOProjox3bhZtrEQYJvzENT1Uui0YlwOSG5EoVrSBoX98xSptPDiSA+8shu7Ln7IpL0KEKxHNd6/kB4OCvwTRgdk3R8szXfCOn19ZRynZk9MJ1mbQeIz8O3l5E0j4GyC0QPoZxZE2cbvsrDysfuCEeeg/sOaB2E9WYjd8+yh70RcTfwiwh2NBQn41rPnTUPZwy+yYALRRvct3BhDTQuM7OfzYZZ2wUi+TJIjyeUx+Ka82fUxNmAb1LgipxgNyO/jqR1uZndPaAe9oD49K9B8wRIlhDKI3Gt3WcDxOmBb1KzyjaB7yB/OUlrjZn9xyCZtQUTE3paM0vaB4qTITmWUB6Fa+5a/54QfAlyYDalJs4UfELVZtMmHpbA9/F+DQmXmo3c1fNebXUL68EA8dkXQLoYkuMnglhC8NMK4tTBNzlwOfBt8JfDROC6zBo44LYCxN7WzPvg2ytIGscS/HG4ZrOODhDC1IE4nfB1A2eWYs2JwOHXgV0Gzdt7BqG0M7sZBh8n9/DZF+LTxSTJSQT/Vlxz3nSCuOPwSWET4EJR4Oz7eH8pSevSujH8wI+OUwjib0C2DJKlhPBGXLMxEUQcVfNKGwj4Oh52AxcK4fgBhIugdRmsusNspR9W4LbDwxfh20tJmosJZS+IJVV2f4dA3D74+ppVFhBuw9kaaFwK3DPMo+MUmnggZCfUIL6hP4hmVe+2GYRPBFDASLFWx0Phwj0E1uCalwG3mlkRPRx9MbAEGktBh0E6MhUgbj18/YDDQ/A/xLEWml+qgfM7i1mbMdEBbuKJDAyyA8FOADuFwEHjh4i3AcQdga9zJrYbuOomgrsJWoOzy6Fxq5nl0cPJQGwfgOdEkmQJgTfi0tb2zmo2D19ndIT6AHMNHP6HwGXg1kP6bTPLdnazNmOgbQqiEsgPAi0huGVgrx0DUTlIk4O4rfBNBlwo7ge3ujrixTcjcFsGsdvD+vED8NlykvQE0JsgbW4LiJvCN3bHQDdwAMWPCH4tIV1Pmt7YA1xSD6HRrO0CkYMI+VKcnQT2akhtExA7t89sDXzjHjpcs275XQPn0tUQroL0RjMbjcDt+Kymfvw38dlyzJ2Ms9dAuunyovcWKIVM8u0g3y7k20Hd8tn9UvEPUrFQ0kjPN0vqP/F2nO0AUZKrP/ATNqIkHSKffUo+u0ehGPcitFV7VD84emT9nP3kswclH+SzTL7tpdDt4YNS8QUVxdGS5vX5ftHDqfTwoosSSa+R8r+U8lvl86KPh14hExVwoRe4f5SKRZuYtWFDNGumTLz33paUHypln5If/aHka4NKSQrS6BH1818on/2iZ9B8UD4/VypPkR7fIwI3W4PphrQCMfu0lN0z7qFUwSdJvv2Q5P9ZRftE6Re7xAg3cBGxpaI4Ur74W/nsx3XkO67+2ovksyfl8yek/AtStrI6lzpxqhQ9HAAPVRwpP/p3Unav5IXUXq6HH54fgRsaE+dJxQnS6Mvq/+8pFSdJen4Eblg8vLclFQsicMNjYtJrYr/NgOjhgHu4YcOYh9az2yW24/64qOk3jj47pX2uix4Ok4dScZykVpx2Ds20M5FGj5A27l/9//E9pPyQSXYyXfRwUD3Uq6sNF2X3VgvB4shNQbylEU2cdbNSSb8tn50t3/5uveFybP21/VW2H5GKB6TiM1JxjH6xyaZZBHFmfXT9lgiSfkNl+8/ki+/JFzkTc3te8tm9Uva3FYh3NqOJszo6Hiw/eraUf08+9xPSCRNTDQ927WFLvv1T+dHPVqmKTWY10cOZBe4VUv5BqfimVLTHfcrVSbJ7+Xah0NZEENt3qmz/ZZWruCiJJk45dGmfx14jtf9cKm6RinLcj6yToM3rPN9kSfYuDgvJZ/fIZ5+SdIikOJhOqYdnTQ5c2f6glG0C3FiS3bdDv+Nl9QHq7rOAZUHwd+C4BFprgbt2pjsWpnjRPeGwbvVY/mrQ8V13PtSG5hB6znluy/GyiffkiRDurTxsXg58Jx6CnxoP68dfAsUSgjsB/OG45hYPXG/hYHWfe/UoC+B2vL+YpLXazO7rs+M29PfqzYBZ+0B2BiFZjtNvQ2PrbjXaloPVk98cK4K+jwtr65tjb4sgbo+Hoy/B2xKS9HgIb4FGzz1/m7+BeutuKZr8LvUMuBnvL6tvmr1vSz/wTmZWb9mJfaFYAe44CAugseuWRsc+L759txRNBmIoPY7b8H4dSWsdcHsEcULZidBzt/t+4BZDYxnBH7Ejd7tv+820k4EYigzsZuQvq+uz/GhnAnFy4J7ZF5orwB1bm1UD1ynWI9um8hJTcTPtZPVZQuHBbsP5VdC6zMx+0GdWM9c97FfnZT9IFxGSE6A8AtfabXuB2zH4NgWxXynAdk8pwJ/ORRAnr3D21POhtYyQHAvlwnGzpqA61lSXkZh0MM0LnLu5rtuy3qz1gznuYW+pwfn4/ESSdAWhOHJKPZwS+LYGxJCP4pIbIKyH8jKzXYYaxM2UFNwL3z6RpHkMoVg4beXoprWA0mZAxN2MirUk875iZg/OEQ83re3p8+MxdzT4ZbjWXtPi4ZTD1x/EidWoyTdCcgP4S6C8wmzX/9zSHHvAgdsT/EKwZTVwz5lOs6Ydvk08lMB6a3U+C8l14Dvl3x/qesp2l3+fReB2BX8C2NGEchmu2V3VOtSD0YCXDtxWEEP2FC79Ot6vJyuvsF0ngLjdfRhmwKw98PkikuZxhHzxuFlzvGiuJMyFalYz1vjkGUi+jg/XkOQXm80fKBA3D1x2JDSOq8vIv6AHuBnp5zBb5eIndq/x2VMkjevw5RqS5pruHnszCeIW5v+LSdLFdQOVGRsdBwK+rfEw5M/g0ivw+dUkI2vN7Fc9INrMetjbyejBXWGvI8AdRyiX45ovHHvSLPVnHJBGKRN67z2Ca6zBl9eRNK80s6enE8RJa6s88shu7LXbUeCOBy2ETtupmR0dBw6+rfGQ/AlwV1WdidrrzJ4zrSB2DZrWUx9nBDiEkC0H6wVu1nv4DVqLMBsv+AOE/Je45hq8v44kuXKqIuLkxYwe3BX2Orpumrmop+HiYLSXGvQWYcJIurvOZk/gGldWXaeaV5vZE1MB4mYKUlXAkZ9AYCmu8bJB7V47qM0xeypvASF/sKvy1vVmtnFbQNyMWS3gDYT8eOBUXPPFgzQ6Dg18m27WBGS9IP4Sl1yBD1eRPHuV2XOfnCIPG1D8DkEnAktw6cvHvucA920fhrbQm4JI/gCkayBc3QfECcfb+hewVYuieAMNWwxhBUoOwDrT3rbABrel8FC2hVYA65nVZL/ENdZXfdgfv9Jsk9be6vKwT1toNaB4A+gEsCXgXj027R0HbtNyfRG+HQJxYj3RkP0cZxdD81K4/yazl7QneXoKvJaQL8fxtgnAqT7AbINt1lDCt1WzmuznOK6gZD1p6zoze3Yzke/N1ZTSluLswM3WOB1wDQ98WwQxQCjvg3AZTqth3k1mJil7DdhJwHKCvXqrK0NH+GYQxNb4zxzyn+GaV8LoeXz0r79lZ58dpI0vgvRU0Ing3tQXOGeGGKpbo4YTvn4mGinWqFgK2TcsGXkrgHz7y7jW6XVPgu1rThLhm8HBtGGVh/nd/PKxN9i++z4rZR+F5llDPWj2Ucqwq1qXVb9HKIo6EhZdVwSgJOQBrIHZ8P/Oc00TPfS4lkAFznWDVVY7znPHQzfHbHS1idZnkHHDPEruTCjuLB666HVUVIQvKirCFxUVFeGLiorwRUVFRfiioiJ8UVFREb6oqAhfVFRUhC8qKsIXFRUV4YuKivBFRUX4oqKiInxRURG+qKioCF9U1NyFr6qfETVc6nQT6v5/1FA5KDlc05ACko8gDrAM1W26PeOlFqj/3axqYxI9HHzoAlKJS80RiodwLYdrJThnSCUhGjhIIyRSibDapyahfBKSx6oLnh4FPQDO4ZqNMQ8rUKMGykOp9jAllBsdrvlyfH4mobyBYAWulZK0YjSc3Uml6vfe45qGa6XIieBvhuJ9uPYroPFdSWa2+6O4jQsgfyeEdQQqD13L1aZHD2fNw1Ax5FKrPTHwt0Lx33Gt16Z1deBzgXMlvRryM4EVuNb+1asU47Uuh6QS8FCPkOBxlkKrKu7rs0cxnYdPVtFIv22WbhLR6p4HXwa+rCx7Dc18BcFOxbVeASR178Do4Yx7OFJVWgvZkzi7CMIl8M1rO63L0k57JTPzZnYn8H5JH6r7Ub+DwDG4Vqt6kXbdTcjcQPYxGF6z6g5Nrar0YSg9+OuRv5Akv9Rs90e7Lk/paTjZ09X3DuAOSX9FWR5H6k4nlItwrfn1BwGQjx5OcZSjnua7ZgKWQukJ5U1IF5L5NbbryC96PAxpbaIf24CpepyNAhcAF0g6AJ+tIHHvxI28shpJSwg+jqQ7uvAe731eRbmQ/xzHebjmKjO7dezSDRtSFiwIVM1Dyk0j3yYeOjPLgHXAOkn7QXYmJKfgmq8BS+o+g9XmTfRwCjxs1o0/8v8E1oJ9Ade8xazaie7pwlRFvh4TQ5+R9D7gU5L+DspFBLcC/IrxaDiAbbQGP8p1+hM4KIuq25IuxDUvN7O6bZYhhU6UK7f2W9Qehp4+8j8HPi7p05TlEaTuDEJxAq61R/VzjZVgjx5u+0yl9tDfAP5CeOKrZns/02em4ntfKp3EwMlG0kuBS6XRj+KzpVhyBq75uirMjvUkt2GvoT99I2SSQt2ohfI+Qjgf17zEzG7vnZKYWdgW6LbgYafFVgFcA1wjaW8oTgP3NnBvxKVpVzSkmpZGDzfvYXE/wV9K6c61Vuu2Lg/HWpxtzkO3NSOpmZWSTFIiyZnN+5GlI3/H9257I/iFUJ5DKJ+u0hWtyrTO1urOPEL2bi97vxHCxZTlUvj5ay1pfdTMbu96b83Mys4MZKpkZtrUQ3vYrPl3rLrkEEyHQ/mPhPJXtYcJLnpYeRg8Cl0pAp9BWA/+NHjoVZbM+xNrtW7DDElp7aHfGg/T7RxJO9GwAK4GrpY2fhSKJeBOx9ybsDQFgc8C1XN3jgW+QgBT3aO8bv5R3lFtnoSvmCU/6xflOu/tdGqSaFgC/wb8m6SPQ7EckpXgFlTRkE5L7J3Iwz5RLhR3o/AVEi42S364rVFuuyLf1kfDXR4wa36ej378MNChEP43oXiIZGRiAn8uJn87UQ6Bq3/f4J+E8CUoF+HSgy0d+SuzXX423VFuO6Ohk5SY2SNmzX8xS44GHULIPwv5L8YPYSRz38MJifCwkVCeT1mejLv/tyoPR37Y46HfXg/TaRlJzz77JuAmSX8K+SmQnkaww3GteiRtV9FhmEfSCdvLjQRcZ937LZwuxDUvNrMH+yy8NRNRbhs9VK+HZs2bgZulxz6BZ0mVdtIRuNZI7aHAwhzwsPr9xzwU4G+D8GVcWGPW+vF0zVTSKTax7Gpab2b2NHAOcI6k3yK0z8AlJ+FGXlQvWIcvgT/WjNNSrNVJETyKc+dDegnOvtG1vezq92KHNk9mGMRy/Ge/3tUJ/K8AX5H00uoQhr0dN/IyOmknQknQsHpYJ8LzJ3DppRAugHSDWVpMt4fpzI2k9j3ge5I+BP5ksKUEluJazfF1hTSQyd+x7WUZbqTuAVgG8F/Hh4tJmpeY2S/7RLmhnZ71SVkEM/sx8GFJn6TMFuLSd4E/Ftfapboiq2cDg+hhZ6aiOkVgadXJ1/87hC/iRi802+PxSaLctCid2ZEUM7ONdI5CSa+C7CRITse1fqN61gAl8PsuvPNf4LgAmqvN7Ds9C2/qNUDJHNEkG21tOmmnjRv3p5mdTpK8A9c6kPHjbIORwB877tWVCA/ZL3HJWhz/Csm/d47szfRMJZ3hkZSe5O9dwF2SPgvlCeBOJPiTcK159Zs08wn88Sjn6ijnoGhD+BpoFa65biwRboZCmDSJOtc0STT8GfBX0p2fhd84AtzpBL8U19q9ej8zEOXseNh9ZK8oofwWLnwR11pdL4lmdaaSDtBIuhpYLY2+HLLlhOQ0XOug6mfsOgrlzNA0JH/7J1HvA62C8AWz5o/6TUnmUpTbwY22nLG007P7gZ0E7lQs/R0smZjAd+am18MJR/YewHExrnmumW2SCGeSI3s7jbpTFl2PNSQtlPy58u3H1FHIJN8u5NtBIdOEP75dSpJ8+7qx1/HtL9aPFX2uD/LtUr4dxl7fZ89I/hIVxUnST0b6/Izx1MfWenjWWU5FsUC+/blt8NDXft2uhx+eX7129tEteliOdnlYZJK/WMreLj2468Sfc0MaPZzcRFdHlq7HnniulP//Uvlt+bx+k0MFmx/18lnYJvh821fXlhpXcbuUf0ja+KI+ZsWDx9sOYo+Hz+wj5e+WL78uX3R5OOrHBsBtga/ysJCKbg/vldp/qSw7sOfnSaKHOxwNz3LK80Mk/3/kswfH3/SxkbTYDHx5ZV5bXVHuMcmfJxWLJDVilJsWD13Xif7O44fIZ38nZf85bkbe62E/+PKxiDnmYXtU3p+vojhZ0rzo4YyMpI/uLpW/J5XfkIp6+Cslycu3r+mC7wuSSoWs45ak8iYpf6+kfXu+TyqdFUfIGfNQe6rM3in59fJ5eywaVh5+bxy+9kckFeMedmYq7T+T2q/Y1MMY5WZyJH29fPYPUvbTejS8eRy+bFUd5X4pn31eKo7oWVu6OELOxtJiQy+Ir5Af/Wv57L7ar590Rb5P174+Ip9/oZqp3NmMHg7WSLqLlP1uNSJWgFZrxfxPpKf26jNCRrMGY2lhXY+1pOxUKftrSbvUkW+FyvZHJO0Zo9xgbtL0RkPrc10SR8ihioY2mddzwUObYwYakNBzLKjeTBE9tU+iBtI/x3jesNfX6N+QGToSpypDuYQYiTOU4TU0rTZc2p+X/BoV7SXSva3NrTeiZmW9l0x8LD9U8v8kn13bSR1Ej4bO3Fsa9WL9y+MphvzuOmf0sj5rwRgNZy3KPfsCKX+PVH5LvqiT7NndnVlLhG9Y4fPtcyWV8qN5V3J9VCrXqcze1icxG3dBpy/KuQnT/6I4uopy7Se6kuZeUiHfvm2uw5fuBN7Xi3VTXYsk4JIRSJaQJEsIxf1SdgE0L65rZXZugRqrzRHx2W7o6htyrWTsIPaz+0FyBvhTSJPfAqtuIA+ZB1m9B5hCrJw2FyJfv7OdnQPVvuswbimV16jMzpT0vD6bNPHDsG1Rrit3d29LKk6Q/IXy2VNdUW7TA9bdZztj5JuLsdA6W9eMR0NLoXkMSXIMIX9YPrsAZxdhzZs6t5z0VB2OW96bRDkmRrnR0ZfSdP8F7GRIXwmASyBk3TdLpzvre5bu9J+a6gPgCAiyTr39vcHeB+V78eWNUnE+iV9jZg91R0N28rxTT/6tutH2Zz+bxwv2PoEkPQ1fHIdr1gWXsvFq3Wbxcxfhm7AytKqHARDy8QI7rnkYJIcR8k9KxQWUrCZN/60rGnaXHtBOAl33Wq5+H7LXE8JKcCtxzZcAkGwS5ZL4QYvwbc20NMVQXSJPuMae4N5D6t9DKL+vsn0BmT/PzLq6z2xIYUGYi5s0PcWwOuUkngv+RAIrQUfhmv2K7MbPWIRvez5xGObq0nJFHQ1Jca3XQfo6RrIPyxdX4NJzga/X/Sx6G81oyIFz9Xjkx6Nc/hbQckJ+Kq65b3VF3hvloiJ8UxwNu0d2l86vSquzklDcK59dSB6+YGb3j206DGE07Ckl36nV8mvgVwArkd6KNcCpThFAXS4wfp4ifDOySQOhVFW/E1d3gf0IzfxPJX8NZfgSaXpFXRxq4A8H91SVC1QFkBMo3wosh/wd0HxudfVYlEswi+u4CN+sRcOelEUyD9wyUrcMih9L2UXQvLCunFVN2+pml4MQDftHuWdfCI13gH8buIPrGfR4lDNLYpSL8A1aNHQEL/Cdup8vBf6cUHxAKq8BVsEza/tURp7RaNhnTVrq3ntbvOQlR5O60wjFElyjaiM9se5mjHIRvmGIhtYVDV0KyWJgMWHeg/LZhTi72Kz5rZlM4PdNhGvj/pD+LoG34zqJ8HTi5onFz0mEb2ijoaoEvmQkrX3B/oRQvk/yG/D5apJitZk9Mh3RsIpy1yewYDwRrkd2w+9+PEmykuAX4hrzxnstxER4hG9OQVgn8M0mJvBJjyQZOZJgH5P8+RDWQnrDVCTwe6Jc5/V+i9BeQUhOJ2nsX0U5xUR4hG+nmpbWCfzOcbbGXuDeC7wXyltVtr9KUn5lM/39trh50pUI3xP8EgJvh+Jo3EhMhEf4dnIJG9vA6E7gW+tgkvRgAh+S/GUQzof02k5Nk65uT74nynUamVRRLs9/h0QnE/LTcc29q0R4iInwCF9U32jYHZFcuju406o/5Q9Uti8iCefWXYF6n97pALUXvjgZc6fidDg0HKirE3BMhA+S4ug3iJs0ZgmhFKHtq02Q9ECS1tkEd4/kV0nZKZ0mLlUpvfxwqTgH8ntIGv+MSxag4AhZSciFueo1Ld6gGiNf1FZGQ+uXwF8BzRWw9wLgBmAfglbjGs+vmlLG414RvqipjYbjCfwC10phDCxH3QqW4C0mwuO0M2r61oZJ7VvPrqfFuicRvqioqAhfVFSELyoqKsIXFRXhi4qK8EVFRUX4oqIifFFRURG+qKgIX1RUVIQvKirCFxUVFeGLiorwRUVFRfiioiJ8UVFREb6oqAjfTElsctd31JD4FuEbcnXKK5RIEcKBxk2iqjsawBrM8bIYc7iA0sEd0B6rhpnWCNDpR+Cpuu7EmicDAZwCmOGaDqxZf+FRoIiRbwhlZqUkw7X+FDgU8v9NyB/AtQzXSnEtQxJSjIizAZyCRwq4huFGElzLEYqHIZwD+Urc08d3elYMc2vtnTTyjZmWATcCN0raFcqjQMcTwmJca7/qPRCEvKqNGSPidE4pA2C4hgNX1yTNH8elV4CuwjXXmdlTO8tbku4kvnf6GzwLrAPWSZpPmR1F6hYTtATX2reaCUQQpwE4cGkCSacI8BO4xhVQfg03us5sj8d6vWIa+xRG+GY2AnZ6GXQ6smJmzwBrgbWS/hT8IkiOIxTH41q/NhFEdfocRBC3H7hncPY1KNfhWuvMrAe4611XD8EY+eboNNT3AfEp4KvAVyU9B/xCsIWEcnENYvV58nmgeo0IYn/gVHXhbXSmlM/guBZffI2kvNhs5OGeCOeo2p6FMWB3Iu205eInAVFm9uREEPMTwS2EsJBkZI8xEEPRadG1c4I4GXDkOcFfiQvX4JoXm1k3cJ2K2zstcBG+bQPxi8AXJT0P8mUEdyz4hbjWc6pnewjlzgFiBVwFXS9wlN8BrQOttyS9exLgOnm8qAjfVoGY1Iv/XwHnAOdIT+2F1zKS5mKCPxbXmj9nQdwUuHpwKnJCeTPy6yhZbyONuyJwEb6pBrHsA+KjwL8C/yppH3x7BUnzGII/CtfatXp2CcGXIAdmQwWiULXJ1AtcWUL5fbxfQ8Kllozc1cNpWr8/IQIX4ZtuEL2ZPQR8DvjcOIiNYwnhOFyrPq1RQAiDDWI3cGYp1hoHLhS34cJaaF3GqlV32MqVvhe4epoegYvwDQKI7VdCtpSQLAO9AddqTASRKp812yBKYRPgQiGs/AHer8LbZTTX3m4WgYvwDQ+I9wD3CD6DsgMhOx6SpZODaDZjbZtFAAWMFNeqt/xLQXEPQWtwzcuAWy1tFBG4CN8wgugAZ2Yl1roTuFPibyA7ELIlkKwg2EFVl9kZALHaOPETgROE/B4cl4BdDo1bLbE8AhfhG3YQAxDqaGhjINIBUX+Dyw+CbEk1NbXXjoGoHKQdB3EicMb4Odb7celqynAVP/npN+0Vr8gicFFzWpJMkqs/4N2PJ5JeL2UflfLbFQqNKWSSbxfybV//u6y+MHpk/dz95LMHpSD5zMu3w9j1Cp0XkXz2E8l/RtJRkub1fP+0/rniqZ2onRnEWxpSfqj86Kflsx9K5TiIyiTfzvrD50v5rPtiyWcPScW5KopjJgEuicBFRRD7R8SmpEOk7JPy2Q/kCz9O1gT4Hqppk3z2c/n8HKlYIT2+RwQuKmrbQEw2AfEnPxmRdIx8+x/li2el4qjq+o3711PK1So3niZpz57XcxG4wdT/Ay1n0VN4PQoSAAAAAElFTkSuQmCC";
const EMB_NEGRO = "data:image/png;base64,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";
function EmblemaFOSMON({ size=22, dark=false, opacity=1 }) {
  const h = Math.round(size * 516/447);
  return <img src={dark?EMB_NEGRO:EMB_WHITE} width={size} height={h} alt="FOSMON"
    style={{display:"block",flexShrink:0,opacity,imageRendering:"crisp-edges"}}/>;
}

// ── ROLES Y USUARIOS ───────────────────────────────────────────────────────
const USUARIOS = [
  { correo:"ofosado@fosmon.com.mx",   nombre:"Oscar Fosado Monsalvo",        rol:"director_general",     pass:"fosmon2026" },
  { correo:"ofosadog@fosmon.com.mx",  nombre:"Dir. de Operaciones",          rol:"director_operaciones",  pass:"fosmon2026" },
  { correo:"aoliva@fosmon.com.mx",    nombre:"Alejandro Noe Oliva Somellera",rol:"gerente_construccion",  pass:"fosmon2026" },
  { correo:"pcastillo@fosmon.com.mx", nombre:"Pablo Castillo Villalobos",    rol:"administrador_obra",    pass:"fosmon2026" },
];

const ROL_LABEL = {
  director_general:    "Director General",
  director_operaciones:"Director de Operaciones",
  gerente_construccion:"Gerente de Construcción",
  administrador_obra:  "Administrador de Obra",
};

// Permisos: can(rol, modulo, accion)
// acciones: 'ver' | 'editar'
// modulos: 'dash','captura','gastos','estimaciones','riesgo','personal_detalle','todas_obras'
const PERMISOS = {
  director_general:    { dash:"ver", captura:null, gastos:"ver", estimaciones:"ver", riesgo:"ver", todas_obras:true },
  director_operaciones:{ dash:"ver", captura:"editar", gastos:"editar", estimaciones:"editar", riesgo:"ver", todas_obras:true },
  gerente_construccion:{ dash:"ver", captura:"editar", gastos:"ver", estimaciones:"ver", riesgo:"ver", todas_obras:true },
  administrador_obra:  { dash:"ver", captura:null, gastos:"editar", estimaciones:"editar", riesgo:"ver", todas_obras:false },
};

function can(rol, modulo, accion="ver") {
  const p = PERMISOS[rol];
  if (!p) return false;
  const v = p[modulo];
  if (!v) return false;
  if (accion === "ver") return v === "ver" || v === "editar";
  return v === "editar";
}

const css = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:${C.bg}; color:${C.textPri}; font-family:system-ui,-apple-system,sans-serif; }
  ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:${C.bg}}
  ::-webkit-scrollbar-thumb{background:rgba(255,254,249,0.15);border-radius:2px}
  input,select{font-family:inherit;outline:none}
  input:focus,select:focus{border-color:${C.caliza}!important}
  button{cursor:pointer;font-family:inherit}
  .fotodrop{border:1.5px dashed rgba(255,254,249,0.15);border-radius:8px;padding:8px;
    text-align:center;cursor:pointer;font-size:10px;color:rgba(255,254,249,0.35);transition:all .2s}
  .fotodrop:hover{border-color:${C.caliza};color:${C.caliza}}
  .fotothumb{position:relative;border-radius:6px;overflow:hidden;aspect-ratio:4/3;cursor:zoom-in}
  .fotothumb img{width:100%;height:100%;object-fit:cover;display:block}
  .fotodel{position:absolute;top:3px;right:3px;background:rgba(0,0,0,.7);border:none;
    color:#fff;width:18px;height:18px;border-radius:50%;font-size:11px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}
  .fotothumb:hover .fotodel{opacity:1}
  .lb{position:fixed;inset:0;background:rgba(13,22,25,.95);z-index:999;
    display:flex;align-items:center;justify-content:center;padding:16px;cursor:pointer}
  .lb img{max-width:90vw;max-height:85vh;border-radius:8px;object-fit:contain}
  input[type=range]{accent-color:${C.caliza};width:100%}
  .noscroll::-webkit-scrollbar{display:none}
`;

// ── HELPERS ────────────────────────────────────────────────────────────────
const MXN = n=>(Math.abs(n)||0).toLocaleString("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0});
const NUM = (n,d=1)=>Number(n||0).toLocaleString("es-MX",{maximumFractionDigits:d});
const semA = p=>p>=85?C.green:p>=55?C.yellow:C.red;
const semM = p=>p>15?C.green:p>=6?C.yellow:C.red;

// ── ATOMS ──────────────────────────────────────────────────────────────────
function Card({children,style,accent}){
  return <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:10,
    padding:"11px 13px",...(accent?{borderLeft:`3px solid ${accent}`}:{}),...style}}>{children}</div>;
}
function Tit({children}){
  return <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginBottom:9,letterSpacing:"0.02em"}}>{children}</div>;
}
function Kpi({label,value,sub,color,size=15}){
  return <div style={{background:C.bg,border:`0.5px solid ${C.border}`,borderRadius:8,
    padding:"9px 11px",borderLeft:`3px solid ${color}`}}>
    <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:size,fontWeight:600,color,lineHeight:1.2}}>{value}</div>
    {sub&&<div style={{fontSize:9,color:C.textMut,marginTop:2}}>{sub}</div>}
  </div>;
}
function Bar({pct,color}){
  return <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:5,overflow:"hidden"}}>
    <div style={{width:`${Math.min(pct||0,100)}%`,height:"100%",background:color||C.caliza,borderRadius:99,transition:"width .4s"}}/>
  </div>;
}
function Bdg({children,color,small}){
  return <span style={{background:`${color}22`,color,border:`0.5px solid ${color}44`,borderRadius:3,
    padding:small?"1px 4px":"1px 6px",fontSize:small?8:9,fontWeight:600,whiteSpace:"nowrap"}}>{children}</span>;
}
function Inp({style,...rest}){
  return <input {...rest} style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
    padding:"5px 7px",color:C.textPri,fontSize:11,width:"100%",...style}}/>;
}
function Sel({children,style,...rest}){
  return <select {...rest} style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
    padding:"5px 7px",color:C.textPri,fontSize:11,...style}}>{children}</select>;
}
function PrimaryBtn({children,onClick,disabled}){
  return <button onClick={onClick} disabled={disabled}
    style={{background:disabled?"rgba(255,254,249,0.2)":C.caliza,border:"none",borderRadius:8,padding:10,
      color:disabled?C.textMut:C.bg,fontSize:13,fontWeight:700,width:"100%",marginTop:6,
      letterSpacing:"0.03em",cursor:disabled?"not-allowed":"pointer"}}>{children}</button>;
}
function SecBtn({children,onClick,style}){
  return <button onClick={onClick} style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
    padding:"5px 10px",fontSize:11,color:C.textSec,...style}}>{children}</button>;
}
function ReadOnly({children}){
  return <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:9,
    color:C.yellow,background:"rgba(202,138,4,0.12)",borderRadius:4,padding:"2px 7px",
    border:"0.5px solid rgba(202,138,4,0.25)",marginLeft:8}}>🔒 Solo lectura</div>;
}

function Lightbox({url,onClose}){
  if(!url)return null;
  return <div className="lb" onClick={onClose}><img src={url} alt=""/></div>;
}
function FotoUploader({fotos,onAdd,onDel}){
  const ref=useRef(); const[lb,setLb]=useState(null);
  const leer=useCallback(files=>{
    Array.from(files).filter(f=>f.type.startsWith("image/")).forEach(f=>{
      const r=new FileReader();r.onload=e=>onAdd({id:Math.random().toString(36).slice(2),url:e.target.result});r.readAsDataURL(f);
    });
  },[onAdd]);
  return <>{fotos.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:7}}>
    {fotos.map(f=><div key={f.id} className="fotothumb" onClick={()=>setLb(f.url)}>
      <img src={f.url} alt=""/><button className="fotodel" onClick={e=>{e.stopPropagation();onDel(f.id);}}>×</button>
    </div>)}
  </div>}
  <div className="fotodrop" onClick={()=>ref.current?.click()}>
    📷 {fotos.length>0?`${fotos.length} foto(s) — agregar más`:"Agregar fotos de evidencia"}
  </div>
  <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>
  <Lightbox url={lb} onClose={()=>setLb(null)}/></>;
}
function ConceptoFotos({fotos,onAdd,onDel}){
  const ref=useRef();const[lb,setLb]=useState(null);
  const leer=useCallback(files=>{
    Array.from(files).filter(f=>f.type.startsWith("image/")).forEach(f=>{
      const r=new FileReader();r.onload=e=>onAdd({id:Math.random().toString(36).slice(2),url:e.target.result});r.readAsDataURL(f);
    });
  },[onAdd]);
  return <div>{fotos.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:5}}>
    {fotos.map(f=><div key={f.id} className="fotothumb" onClick={()=>setLb(f.url)}>
      <img src={f.url} alt=""/><button className="fotodel" onClick={e=>{e.stopPropagation();onDel(f.id);}}>×</button>
    </div>)}
  </div>}
  <div className="fotodrop" style={{fontSize:9,padding:"5px 8px"}} onClick={()=>ref.current?.click()}>
    📷 {fotos.length>0?`${fotos.length} foto(s)`:"Agregar foto"}
  </div>
  <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>
  <Lightbox url={lb} onClose={()=>setLb(null)}/></div>;
}

// ── DATOS ──────────────────────────────────────────────────────────────────
const CATALOGO = {
  "A1.4": {
    nombre: "ANDADOR PEATONAL",
    imp_total: 33217646.21,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:598.51,pu:202.15,importe:120988.8,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:778.06,pu:39.38,importe:30640.0,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:11670.95,pu:36.01,importe:420270.91,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:258.51,pu:1161.66,importe:300300.73,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-002",desc:"FIRME DE CONCRETO HIDRÁULICO F’C = 150 KG/CM², DE 16 CM DE ESPESOR, REFORZADO CON MALLA ELECTROSOLDADA 6-6/10-10; INCLUY",unidad:"M2",cantidad:6852.48,pu:1253.2,importe:8587527.94,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-003",desc:"CONSTRUCCIÓN DE DENTELLÓN PERIMETRAL DE 10 CM DE ANCHO POR 17 CM DE ALTURA, REFORZADO A BASE DE ARMEX 15 X 10 X 4, CON C",unidad:"M",cantidad:71.28,pu:562.63,importe:40104.27,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_10",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 10 X 10 DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. 1",unidad:"M2",cantidad:2810.37,pu:3652.58,importe:10265101.25,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:3160.18,pu:3100.09,importe:9796842.42,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41R",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE REAL TOPACIO REGULAR 10X10 PORFIDO DE 4CM DE ESPESOR, ASENTADO CON MORTERO CEMENTO AR",unidad:"M2",cantidad:881.93,pu:4069.11,importe:3588670.18,avance:0,fotos:[]},
      {clave:"0219-OAX-FCH-43",desc:"CONCRETO EN ESTRUCTURA DE 20CM DE ESPESOR, HECHO EN OBRA DE F´C= 250 KG/CM2 INCLUYE: ACARREOS, CIMBRADO Y DESCIMBRADO, C",unidad:"M3",cantidad:11.45,pu:5868.97,importe:67199.71,avance:0,fotos:[]},
    ],
  },
  "B1.10.1": {
    nombre: "MOBILIARIO URBANO",
    imp_total: 22148492.26,
    conceptos: [
      {clave:"0219-OAX-BCAN-135",desc:"SUMINISTRO Y FABRICACION DE BANCA DE CANTERA RUSTICA 135CM DE LONGITUD, 45CM DE ANCHO, 40CM DE ALTURA INCLUYE MARTELINAD",unidad:"PZA",cantidad:180.0,pu:38094.54,importe:6857017.2,avance:0,fotos:[]},
      {clave:"0219-OAX-APB-C1",desc:"SUMINISTRO, FABRICACIÓN Y COLOCACIÓN  DE APARCABICIS, CON DIMENSIONES DE 46 Cm DE ANCHO Y 75 CM DE ALTURA, FABRICADO EN ",unidad:"PZA",cantidad:50.0,pu:16553.08,importe:827654.0,avance:0,fotos:[]},
      {clave:"0219-OAX-BLRD-50",desc:"SUMINISTRO Y COLOCACIÓN DE BOLARDOS DE ACERO DE PLACA METALICA 5/8'' CON DIMENSIONES DE 46 CM DE DIAMETRO Y 0.50 M DE AL",unidad:"PZA",cantidad:598.0,pu:19562.34,importe:11698279.32,avance:0,fotos:[]},
      {clave:"0219-OAX-BMT-CT1",desc:"FABRICACION Y MONTAJE DE BASURERO METALICO DE 0.43M X 0.43M X 0.60M A BASE DE LAMINA NEGRA CALIBRE 11 SEGÚN DISEÑO DE PR",unidad:"PZA",cantidad:40.0,pu:24418.79,importe:976751.6,avance:0,fotos:[]},
      {clave:"0219-OAX-SEÑ-INF01",desc:"SUMINISTRO Y COLOCACIÓN DE SEÑALÉTICA INFORMATIVA, PREVENTIVA Y RESTRICTIVA, FABRICADA EN LÁMINA GALVANIZADA CALIBRE 18,",unidad:"PZA",cantidad:123.0,pu:10823.34,importe:1331270.82,avance:0,fotos:[]},
      {clave:"0219-OAX-SEÑ-INF02",desc:"SUMIISTRO, FABRICACION Y MONTAJE DE SEÑALETICA, TOTEM DE SEÑALAMIENTO MIXTO CON ESTRUCTURA DE ACERO ELECTROPINTADO, MEDI",unidad:"PZA",cantidad:9.0,pu:50835.48,importe:457519.32,avance:0,fotos:[]},
    ],
  },
  "B1.4": {
    nombre: "ANDADOR PEATONAL",
    imp_total: 17739848.09,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:945.47,pu:202.15,importe:191126.76,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:180.25,pu:1161.66,importe:209389.22,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-002",desc:"FIRME DE CONCRETO HIDRÁULICO F’C = 150 KG/CM², DE 16 CM DE ESPESOR, REFORZADO CON MALLA ELECTROSOLDADA 6-6/10-10; INCLUY",unidad:"M2",cantidad:3604.92,pu:1253.2,importe:4517685.74,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-003.",desc:"CONSTRUCCIÓN DE DENTELLÓN PERIMETRAL DE 10 CM DE ANCHO POR 17 CM DE ALTURA, REFORZADO A BASE DE ARMEX 15 X 10 X 4, CON C",unidad:"ML",cantidad:145.12,pu:562.63,importe:81648.87,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_10",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 10 X 10 DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. 1",unidad:"M2",cantidad:768.24,pu:3652.58,importe:2806058.06,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:1674.11,pu:3100.09,importe:5189891.67,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41R",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE REAL TOPACIO REGULAR 10X10 PORFIDO DE 4CM DE ESPESOR, ASENTADO CON MORTERO CEMENTO AR",unidad:"M2",cantidad:1162.57,pu:4069.11,importe:4730625.21,avance:0,fotos:[]},
      {clave:"0219-OAX-PT-CP01",desc:"PINTURA DE TRAFICO PARA CIRCUITO DE PATINAJE DE 10CM DE ANCHO, APLICADO SOBRE RECINTO, INCLUYE SUMIISTRO DE MATERIAL, HE",unidad:"ML",cantidad:340.07,pu:39.47,importe:13422.56,avance:0,fotos:[]},
    ],
  },
  "A1.7.1": {
    nombre: "TERRACERIAS",
    imp_total: 11569121.13,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:424.28,pu:202.15,importe:85768.2,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:726.06,pu:39.38,importe:28592.24,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:10890.95,pu:36.01,importe:392183.11,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:2121.41,pu:239.47,importe:508014.05,avance:0,fotos:[]},
      {clave:"0219-OAX-RBHD-01",desc:"RELLENO CON BASE HIDRAULICA: 40% ARENA, 30% GRAVA TMA 1', 20% GRAVA TMA 3/4', 10% MATERIAL PARA REVESTIMIENTO, COMPACTAD",unidad:"M3",cantidad:424.28,pu:5093.16,importe:2160925.92,avance:0,fotos:[]},
      {clave:"0219-OAX-GUC-50",desc:"GUARNICION DE 15 X 60 CMS DE ALTURA, DE UN CONCRETO F´C =250 KG/CM2 REFROZADO CON 4 VARILLA DEL NO 3 Y ESTRIBOS DEL NO 2",unidad:"ML",cantidad:894.57,pu:1412.22,importe:1263329.65,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-008",desc:"FIRME DE CONCRETO HIDRAULICO MR-42  DE 20CM DE ESPESOR, REFORZADO CON MALLA ELECTROLDADA 6-6 / 10-10, INCLUYE SILLETAS D",unidad:"M2",cantidad:2121.41,pu:1516.27,importe:3216630.34,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:1262.44,pu:3100.09,importe:3913677.62,avance:0,fotos:[]},
    ],
  },
  "B1.7B": {
    nombre: "SISTEMA DE INFILTRACIÓN Y BOMBEO PLUVIAL",
    imp_total: 7378421.15,
    conceptos: [
      {clave:"0219-OAX-PZO-ABS01",desc:"CONSTRUCCION Y PERFORACION DE POZO DE ABSORCION DE 100.00 MTS DE PROFUNDIDAD Y 18' Ø. INCLUYE: INSTALACION Y DESMANTELAM",unidad:"PZA",cantidad:1.0,pu:2565429.9,importe:2565429.9,avance:0,fotos:[]},
      {clave:"0219-OAX-PZO-EXT01",desc:"CONSTRUCCION Y PERFORACION DE POZO DE EXTRACCION DE 100 MTS DE PROFUNDIDAD Y 14' Ø. INCLUYE INSTALACION  Y DESMANTELAMIE",unidad:"PZA",cantidad:1.0,pu:3390475.76,importe:3390475.76,avance:0,fotos:[]},
      {clave:"0219-OAX-CBOM-C1",desc:"CONSTRUCCION DE CARCAMO DE BOMBEO DE 4.58M DE LARGO X 1.60M DE ANCHO X 1.70 M DE ALTO, A BASE DE MURO DE TABIQUE LIGERO ",unidad:"PZA",cantidad:1.0,pu:249882.82,importe:249882.82,avance:0,fotos:[]},
      {clave:"0219-OAX-EQ-PEXT-01",desc:"SUMINISTRO E INSTALACION DE EQUIPO ELECTROMECANICO PARA CARCAMO DE BOMBEO. INCLUYE: SUMINISTRO E INSTALACION DE TREN DE ",unidad:"PZA",cantidad:1.0,pu:1172632.67,importe:1172632.67,avance:0,fotos:[]},
    ],
  },
  "B1.7": {
    nombre: "ACCESO VEHICULAR",
    imp_total: 7311598.19,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:866.5,pu:202.15,importe:175162.98,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:2190.99,pu:239.47,importe:524676.38,avance:0,fotos:[]},
      {clave:"0219-OAX-GUC-50",desc:"GUARNICION DE 15 X 60 CMS DE ALTURA, DE UN CONCRETO F´C =250 KG/CM2 REFROZADO CON 4 VARILLA DEL NO 3 Y ESTRIBOS DEL NO 2",unidad:"ML",cantidad:749.0,pu:1412.22,importe:1057752.78,avance:0,fotos:[]},
      {clave:"0219-OAX-RBHD-01.",desc:"RELLENO CON BASE HIDRAULICA: 40% ARENA, 30% GRAVA TMA 1, 20% GRAVA TMA 3/4', 10% MATERIAL PARA REVESTIMIENTO, COMPACTADO",unidad:"M3",cantidad:438.21,pu:5093.16,importe:2231873.64,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-008",desc:"FIRME DE CONCRETO HIDRAULICO MR-42  DE 20CM DE ESPESOR, REFORZADO CON MALLA ELECTROLDADA 6-6 / 10-10, INCLUYE SILLETAS D",unidad:"M2",cantidad:2190.99,pu:1516.27,importe:3322132.41,avance:0,fotos:[]},
    ],
  },
  "B1.9.1": {
    nombre: "CISTERNA",
    imp_total: 6908046.86,
    conceptos: [
      {clave:"0219-OAX-TRAZ-03.",desc:"TRAZO Y NIVELACIÓN CON EQUIPO DE TOPOGRAFÍA, INCLUYE: CUADRILLA DE TOPOGRAFÍA, EQUIPO, HERRAMIENTA Y EQUIPO DE SEGURIDAD",unidad:"M2",cantidad:256.12,pu:23.99,importe:6144.32,avance:0,fotos:[]},
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:1037.26,pu:246.09,importe:255259.31,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION.  PRIMER KILOMETRO, INCLUYE: EQUIPO HERRAMIENTA, AC",unidad:"M3",cantidad:1348.44,pu:39.38,importe:53101.57,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION. KILOMETRO SUBSECUENTE, ZONA URBANA INCLUYE: ACARRE",unidad:"M3//KM",cantidad:20226.57,pu:36.01,importe:728358.79,avance:0,fotos:[]},
      {clave:"OAX.ZARP-TN1",desc:"PERFILADO Y ZARPEO DE MUROS DEL ALUD EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MÁXIMA DE 5.00 METROS PARA CISTERNA DE MÓDULO",unidad:"M2",cantidad:313.2,pu:497.2,importe:155723.04,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:154.0,pu:239.47,importe:36878.38,avance:0,fotos:[]},
      {clave:"0219-OAX-CAM-A01",desc:"SUMINISTRO Y COLOCACIÓN DE CAMA DE ARENA DE 10 CM DE ESPESOR INCLUYE: MATERIAL MANO DE OBRA, ACARREOS Y TODO LO NECESARI",unidad:"M2",cantidad:154.0,pu:231.4,importe:35635.6,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE) EN CAPAS NO MAYORES A 20 CMS COMPACTADO AL 90% DE SU PVSM. INCLUYE: MATERIAL, M",unidad:"M3",cantidad:706.93,pu:1161.66,importe:821212.3,avance:0,fotos:[]},
      {clave:"0219-OAX-AQUA-C01",desc:"SUMINISTRO, HABILITADO Y CONFORMADO DE CISTERNA PREFABRICADA WAVIN AQUACELL, CON UNA DIMENSIÓN DE 14.40M X 9.00M X 2.43M",unidad:"PZA",cantidad:1.0,pu:4815733.55,importe:4815733.55,avance:0,fotos:[]},
    ],
  },
  "B1.10.4": {
    nombre: "AREA SKATE PARK",
    imp_total: 4983613.51,
    conceptos: [
      {clave:"0219-OAX-TRAZ-03.",desc:"TRAZO Y NIVELACIÓN CON EQUIPO DE TOPOGRAFÍA, INCLUYE: CUADRILLA DE TOPOGRAFÍA, EQUIPO, HERRAMIENTA Y EQUIPO DE SEGURIDAD",unidad:"M2",cantidad:800.0,pu:23.99,importe:19192.0,avance:0,fotos:[]},
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:360.0,pu:246.09,importe:88592.4,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION.  PRIMER KILOMETRO, INCLUYE: EQUIPO HERRAMIENTA, AC",unidad:"M3",cantidad:468.0,pu:39.38,importe:18429.84,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION. KILOMETRO SUBSECUENTE, ZONA URBANA INCLUYE: ACARRE",unidad:"M3//KM",cantidad:7020.0,pu:36.01,importe:252790.2,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE) EN CAPAS NO MAYORES A 20 CMS COMPACTADO AL 90% DE SU PVSM. INCLUYE: MATERIAL, M",unidad:"M3",cantidad:160.0,pu:1161.66,importe:185865.6,avance:0,fotos:[]},
      {clave:"0219-OAX-CIM-GRA01",desc:"SUMINISTRO Y TENDIDO DE CAMA DE FILTRO A BASE DE GRAVILLA 3/4', CRIBADO DE 10 CMS DE ESPESOR, GRADO DE ACOMODADO 8% DE S",unidad:"M3",cantidad:80.0,pu:2491.89,importe:199351.2,avance:0,fotos:[]},
      {clave:"0219-OAX-EST-C250",desc:"FIRME DE CONCRETO HIDRAULICO PREMEZCLADO F'C = 250KG/M2 DE 20CM DE ESPESOR, INCLUYE: SUMINISTRO, ARMADO Y COLOCACION DE ",unidad:"M2",cantidad:440.49,pu:1340.11,importe:590305.05,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-LOOP",desc:"CONSTRUCCIÓN DE MODULO #1 LOOP SANTI + QUATER PIPE (X2), EJE LONGITUDINAL DE 4.75M, EJE TRANSVERSAL DE 10.00 M, . INCLUY",unidad:"PZA",cantidad:1.0,pu:467437.93,importe:467437.93,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-SPEED",desc:"CONSTRUCCIÓN DE MODULO #2 SPEED BUMP / HIPPIE PUMP, DIAMETRO 4.20M, ALZADO DE 0.55M A PARTIR DE NPT. INCLUYE: EXCAVACION",unidad:"PZA",cantidad:1.0,pu:242403.37,importe:242403.37,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-DIAM",desc:"CONSTRUCCIÓN DE MODULO #3 DIAMON - BUMP TO BUMP, EJE LONGITUDINAL DE 5.48M Y EJE TRANSVERSAL DE 8.46M. INCLUYE: EXCAVACI",unidad:"PZA",cantidad:1.0,pu:432207.62,importe:432207.62,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-FBOX",desc:"CONSTRUCCIÓN DE MODULO #4 FUN BOX CRUZ FIALLO, EJE LONGITUDINAL DE 5.48M Y EJE TRANSVERSAL DE 8.00M. INCLUYE: EXCAVACION",unidad:"PZA",cantidad:1.0,pu:315762.69,importe:315762.69,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-PYRAM",desc:"CONSTRUCCIÓN DE MODULO #5 PLANTA 3 SIDE PYRAMID HIP, EJE LONGITUDINAL DE 5.04M Y EJE TRANSVERSAL DE 3.95M. INCLUYE: EXCA",unidad:"PZA",cantidad:1.0,pu:270597.64,importe:270597.64,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-BUMP",desc:"CONSTRUCCIÓN DE MODULO #6 BUMP TO BUMP TO DIAMOND, EJE LONGITUDINAL DE 4.70M Y EJE TRANSVERSAL DE 8.105M. INCLUYE: EXCAV",unidad:"PZA",cantidad:1.0,pu:315193.31,importe:315193.31,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-MRAMP",desc:"CONSTRUCCIÓN DE MODULO #7 MINI RAMP, EJE LONGITUDINAL DE 19.06M Y EJE TRANSVERSAL DE3.40M. INCLUYE: EXCAVACION DE TERREN",unidad:"PZA",cantidad:2.0,pu:462481.25,importe:924962.5,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-BMX",desc:"CONSTRUCCIÓN DE MODULO #8 BOLW BMX > SKATE TIPO CACAHUATE, EJE LONGITUDINAL DE 13.10M, EJE TRANSVERSAL DE 8.25 M, . INCL",unidad:"PZA",cantidad:1.0,pu:660522.16,importe:660522.16,avance:0,fotos:[]},
    ],
  },
  "A1.3": {
    nombre: "DRENAJE PLUVIAL",
    imp_total: 4644580.24,
    conceptos: [
      {clave:"0219-OAX-EX25-24",desc:"EXCAVACIÓN POR MEDIOS MECÁNICOS EN TERRENO TIPO “B”, A UNA PROFUNDIDAD MÁXIMA DE 2.50 METROS, PARA DRENAJE PLUVIAL; INCL",unidad:"M3",cantidad:1289.31,pu:220.31,importe:284047.89,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:1676.12,pu:39.38,importe:66005.61,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:25141.69,pu:36.01,importe:905352.26,avance:0,fotos:[]},
      {clave:"0219-OAX-AFT-35",desc:"AFINE DE FONDO DE CEPA PARA LA INSTALACIÓN DE TUBERÍA PLUVIAL, POR MEDIOS MANUALES CON BAILARINA; INCLUYE: MANO DE OBRA,",unidad:"M2",cantidad:573.05,pu:105.17,importe:60267.67,avance:0,fotos:[]},
      {clave:"0219-OAX-CA5-36",desc:"SUMINISTRO Y COLOCACIÓN DE CAMA DE ARENA DE 10 CM DE ESPESOR PARA ASENTAR TUBERÍA PEAD CORRUGADA DE 45 CM DE DIÁMETRO; I",unidad:"M2",cantidad:573.05,pu:231.4,importe:132603.77,avance:0,fotos:[]},
      {clave:"0219-OAX-TPDR-31",desc:"TRABAJOS DE PERFORACIÓN DE TUBERÍA DE DRENAJE DE PEAD CORRUGADO DE 18' DE DIÁMETRO, CON TALADRO Y BROCA DE 1/2', A MEDIO",unidad:"M",cantidad:115.62,pu:168.87,importe:19524.75,avance:0,fotos:[]},
      {clave:"0219-OAX-TP45-34",desc:"SUMINISTRO E INSTALACIÓN DE TUBERÍA DE PEAD CORRUGADO DE 18' DE DIÁMETRO INTERIOR PARA DRENAJE PLUVIAL, HASTA 3 M DE PRO",unidad:"M",cantidad:764.04,pu:2322.41,importe:1774414.14,avance:0,fotos:[]},
      {clave:"0219-OAX-ACT-37",desc:"ACOSTILLADO DE TUBERÍA CON MATERIAL DE BANCO (GRAVA 3/4'), CRIBADO, LIMPIO Y LIBRE DE FINOS, COLOCADO EN CAPAS NO MAYORE",unidad:"M3",cantidad:136.61,pu:1571.4,importe:214668.95,avance:0,fotos:[]},
      {clave:"0219-OAX-GTX-H01",desc:"SUMINISTRO Y COLOCACIÓN DE GEOTEXTIL NO TEJIDO DE POLIPROPILENO, PUNZONADO MECÁNICAMENTE, CON UN GRAMAJE MÍNIMO DE 200 G",unidad:"PZA",cantidad:16.0,pu:11231.95,importe:179711.2,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:867.71,pu:1161.66,importe:1007984.0,avance:0,fotos:[]},
    ],
  },
  "A1.5": {
    nombre: "JARDINERIA",
    imp_total: 4248745.89,
    conceptos: [
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:416.68,pu:246.09,importe:102540.78,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:541.68,pu:39.38,importe:21331.36,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:8125.26,pu:36.01,importe:292590.61,avance:0,fotos:[]},
      {clave:"0219-OAX-CIM-J12X30",desc:"CONSTRUCCIÓN DE CADENA DE CONCRETO DE 0.15 X 0.30 M, CON CONCRETO PREMEZCLADO BOMBEABLE F’C = 250 KG/CM²; INCLUYE: SUMIN",unidad:"ML",cantidad:1090.56,pu:1010.73,importe:1102261.71,avance:0,fotos:[]},
      {clave:"0219-OAX-SAR-44",desc:"SUMINISTRO Y SIEMBRA DE ÁRBOL (PALO MULATO, PRIMAVERA, CEIBA, POCHOTE GRIS, FLOR DE MAYO, GUIEXUUBA, COQUITO, GUAMÚCHIL,",unidad:"PZA",cantidad:71.0,pu:19095.84,importe:1355804.64,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-005",desc:"SUMINISTRO Y COLOCACIÓN DE CAPA DE TEZONTLE DE 0.15 M DE ESPESOR, EN JARDINERAS TRIANGULARES DE 4.24 X 4.24 M Y 6.00 M D",unidad:"M3",cantidad:95.85,pu:4033.16,importe:386578.39,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-006",desc:"SUMINISTRO, FABRICACIÓN Y COLOCACIÓN DE MARCO METÁLICO TRIANGULAR A BASE DE ÁNGULO DE 4' X 1/4', CON LAS SIGUIENTES DIME",unidad:"PZA",cantidad:71.0,pu:13910.4,importe:987638.4,avance:0,fotos:[]},
    ],
  },
};

const NOMINA_S18 = [
  {nombre:'EDUARDO BOTELLO VASQUEZ',categoria:'DIRECTOR DE OBRA',tipo:'I',salarioSemanal:7466.67,salarioDiario:1244.445,diasTrabajados:6.0,horasExtra:0,importeDias:7466.67,importeHE:0,total:8666.67,semana:18},
  {nombre:'JHOAN SMITH MONTIEL CORTES',categoria:'GERENTE DE HSE',tipo:'I',salarioSemanal:6500.0,salarioDiario:1083.3333,diasTrabajados:6.0,horasExtra:0,importeDias:6500.0,importeHE:0,total:8000.0,semana:18},
  {nombre:'PABLO CASTILLO VILLALOBOS',categoria:'CONTROL DE OBRA',tipo:'I',salarioSemanal:8600.0,salarioDiario:1433.3333,diasTrabajados:6.0,horasExtra:0,importeDias:8600.0,importeHE:0,total:9800.0,semana:18},
  {nombre:'JUAN EDGAR SUAREZ PRIETO',categoria:'SUPERVISOR DE OBRA',tipo:'I',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:0,importeDias:5000.0,importeHE:0,total:5000.0,semana:18},
  {nombre:'JOSE EMMANUEL ALEGRIA CUETO',categoria:'LOGISTICA',tipo:'I',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:10.0,importeDias:5000.0,importeHE:1200.0,total:7400.0,semana:18},
  {nombre:'ERICK GUTIERREZ JIMENEZ',categoria:'AUX. ADMINISTRATIVO',tipo:'I',salarioSemanal:5500.0,salarioDiario:916.6667,diasTrabajados:6.0,horasExtra:0,importeDias:5500.0,importeHE:0,total:5500.0,semana:18},
  {nombre:'VIDAL MORALES HERNANDEZ',categoria:'VELADOR',tipo:'I',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:6.0,horasExtra:0,importeDias:3500.0,importeHE:0,total:3500.0,semana:18},
  {nombre:'MATEO GONZALEZ PEREZ',categoria:'VELADOR',tipo:'I',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:5.0,horasExtra:0,importeDias:2916.67,importeHE:0,total:2916.67,semana:18},
  {nombre:'MIGUEL AGUILAR EVIA',categoria:'BODEGUERO',tipo:'I',salarioSemanal:3300.0,salarioDiario:550.0,diasTrabajados:6.0,horasExtra:24.0,importeDias:3300.0,importeHE:2880.0,total:7380.0,semana:18},
  {nombre:'JOSE ANTONIO DE JESUS MARIN',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'ALEJANDRO GUZMAN MENDEZ',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'JUAN MIGUEL MORALES GARCIA',categoria:'CABO',tipo:'D',salarioSemanal:6000.0,salarioDiario:1000.0,diasTrabajados:6.0,horasExtra:28.0,importeDias:6000.0,importeHE:4200.0,total:11400.0,semana:18},
  {nombre:'RODOLFO AQUINO HERNANDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:20.0,importeDias:4000.0,importeHE:3000.0,total:8400.0,semana:18},
  {nombre:'JUAN JOSE GARCIA TELLEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'BERENICE CARRILLO RAMIREZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:12.0,importeDias:3000.0,importeHE:1440.0,total:4440.0,semana:18},
  {nombre:'DAVID VAZQUEZ SANTOS',categoria:'TOPOGRAFO',tipo:'D',salarioSemanal:5300.0,salarioDiario:883.3333,diasTrabajados:6.0,horasExtra:16.0,importeDias:5300.0,importeHE:2400.0,total:8900.0,semana:18},
  {nombre:'MIGUEL ANGEL MENDEZ MATIAS',categoria:'CHOFER',tipo:'D',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:6.0,horasExtra:20.0,importeDias:3500.0,importeHE:2400.0,total:5900.0,semana:18},
  {nombre:'MELQUIADES CHAPAN MEMECHI',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'RICARDO JUAREZ SANCHEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:20.0,importeDias:4000.0,importeHE:3000.0,total:8400.0,semana:18},
  {nombre:'MARCOS MANUEL SANCHEZ PEREZ',categoria:'OPERADOR RETRO EXCAVADORA',tipo:'D',salarioSemanal:6500.0,salarioDiario:1083.3333,diasTrabajados:6.0,horasExtra:18.0,importeDias:6500.0,importeHE:2700.0,total:10600.0,semana:18},
  {nombre:'HERMELINDO NUÑEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:19.0,importeDias:4000.0,importeHE:2850.0,total:8250.0,semana:18},
  {nombre:'ISRAEL NUÑEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:19.0,importeDias:4000.0,importeHE:2850.0,total:8250.0,semana:18},
  {nombre:'ALFREDO MACUIXTLE DE JESUS',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'MARICELA HERNANDEZ FRANCO',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:16.0,importeDias:3000.0,importeHE:1920.0,total:4920.0,semana:18},
  {nombre:'SAMUEL MARTINEZ REYES',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'GUSTAVO HERNANDEZ RODRIGUEZ',categoria:'PAILERO',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:5.0,importeDias:5000.0,importeHE:600.0,total:6800.0,semana:18},
  {nombre:'JESUS ABEL GUZMAN DE LA CRUZ',categoria:'SOLDADOR',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:4.0,horasExtra:10.0,importeDias:3333.33,importeHE:1200.0,total:5333.33,semana:18},
  {nombre:'ALEJANDRO HERNANDEZ GERARDO',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:5.0,importeDias:4000.0,importeHE:750.0,total:6150.0,semana:18},
  {nombre:'NOHEMY GABRIELA RODRIGUEZ VELASQUEZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:11.0,importeDias:3000.0,importeHE:1320.0,total:4320.0,semana:18},
  {nombre:'JONATAN CHAPAN CHIBAMBA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:22.0,importeDias:4000.0,importeHE:3300.0,total:8700.0,semana:18},
  {nombre:'ROSENDO GUZMAN MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JORGE GUTIERREZ JAIMES',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:5.0,horasExtra:0,importeDias:3333.33,importeHE:0,total:4500.33,semana:18},
  {nombre:'SAMUEL HERNANDEZ MEDINA',categoria:'CADENERO',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:14.0,importeDias:3000.0,importeHE:1680.0,total:4680.0,semana:18},
  {nombre:'SEVERO RAMIREZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:2.0,importeDias:3000.0,importeHE:240.0,total:3240.0,semana:18},
  {nombre:'HECTOR JIMENEZ HERNANDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:11.0,importeDias:4000.0,importeHE:1650.0,total:5650.0,semana:18},
  {nombre:'JOSE OSVALDO GALLARDO MARTINEZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:20.0,importeDias:3000.0,importeHE:2400.0,total:5400.0,semana:18},
  {nombre:'ALEJANDRO VIDAL SANTIAGO',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:5.0,horasExtra:2.0,importeDias:2500.0,importeHE:240.0,total:2740.0,semana:18},
  {nombre:'JUAN GALINDO MARTINEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'VICTOR VILORIA RAMIREZ',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:7450.0,semana:18},
  {nombre:'ROSENDO JUAN BRIGADA',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'BENIGNO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DAVID BAUTISTA MARTINEZ',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:3.0,horasExtra:17.0,importeDias:2000.0,importeHE:2550.0,total:4550.0,semana:18},
  {nombre:'MIGUEL ANGEL VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'MANUEL GUZMAN MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'RICARDO JULIAN GOMEZ GOMEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JHONATAN DE JESUS  MENDOZA ROMAN',categoria:'ARMADOR',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:15.0,importeDias:4000.0,importeHE:1800.0,total:7000.0,semana:18},
  {nombre:'SILVANO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'MIGUEL ANGEL GOMEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'DAIRON CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DANIEL GOMEZ CRUZ',categoria:'OPERADOR RETRO EXCAVADORA',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:19.0,importeDias:5000.0,importeHE:2280.0,total:8480.0,semana:18},
  {nombre:'ARMANDO GUZMAN BAUTISTA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DANIEL GUZMAN BAUTISTA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JUAN PABLO ROSARIO SANCHEZ',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:15.0,importeDias:4000.0,importeHE:2250.0,total:7650.0,semana:18},
  {nombre:'EPIFANIO VELAZQUEZ GARCIA',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:0,horasExtra:0,importeDias:0,importeHE:0,total:0,semana:18},
  {nombre:'ANGEL LIBRADO NUÑEZ MENDEZ',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'FIDENCIO BELEN RUIZ',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:1.0,horasExtra:0,importeDias:666.67,importeHE:0,total:899.67,semana:18},
  {nombre:'DANIEL FABIAN BERNANDO CANSECO',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:5.0,importeDias:3000.0,importeHE:600.0,total:3600.0,semana:18},
  {nombre:'ANTONIO QUIROZ MORALES',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:3.0,horasExtra:0,importeDias:1500.0,importeHE:0,total:1500.0,semana:18},
  {nombre:'ORLANDO CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'BRAULIO CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'NEREO SANCHEZ SAINOS',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'LEOBARDO JUAREZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'FRANCISCO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'NARCISO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'FREDIBETH VELAZQUEZ ANTONIO',categoria:'ARMADOR',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:3.0,horasExtra:0,importeDias:2000.0,importeHE:0,total:2000.0,semana:18},
  {nombre:'MIGUEL ANGEL GASPAR AGUILAR',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:2.0,horasExtra:0,importeDias:1000.0,importeHE:0,total:1000.0,semana:18},
];

const _OBRAS_BASE = [
  {id:"OAX01",nombre:"Oaxaca Parque Lineal",contrato:"IE-SIC/SSOP/UL-X010-2026",
   cliente:"Gob. Estado de Oaxaca",superintendente:"Ing. Eduardo Botello Vázquez",
   residente:"Ing. Ana Martínez",admin:"L.C. Pablo Castillo Villalobos",
   presupuesto:163348337,gastoGP:29330201,ultimaAct:"27 mayo 2026",
   estado:"activa",pctAnticipo:10,pctFondoGar:5,
   inicio:"2026-05-01",fin:"2026-08-28"},
  {id:"SCT01",nombre:"Libramiento Norte Tramo 2",contrato:"SCT-JAL-2025-047",
   cliente:"SCT Jalisco",superintendente:"Por asignar",residente:"Ing. Luis Campos",
   admin:"C.P. Sandra Ruiz",presupuesto:48500000,gastoGP:7230450,
   ultimaAct:"25 mayo 2026",estado:"activa",pctAnticipo:10,pctFondoGar:5,
   inicio:"2025-01-15",fin:"2025-10-30"},
  {id:"MUN01",nombre:"Planta Tratadora Agua Centro",contrato:"SAPAZA-2025-012",
   cliente:"SAPAZA",superintendente:"Ing. Roberto Díaz",residente:"Ing. Carmen Vega",
   admin:"L.C. Pablo Torres",presupuesto:32000000,gastoGP:30100000,
   ultimaAct:"20 mayo 2026",estado:"terminada",pctAnticipo:10,pctFondoGar:5,
   inicio:"2024-09-01",fin:"2025-06-30"},
];

function loadObras() {
  return _OBRAS_BASE.map(o => {
    try {
      const s = localStorage.getItem(`campo_obra_${o.id}`);
      if (s) { const saved = JSON.parse(s); return {...o, ...saved}; }
    } catch {}
    return o;
  });
}

const SUBS_INIT = [
  {sec:"A1.4",   sub:"Andador Peatonal",             imp:33217646,n:10,a:0,fotos:{}},
  {sec:"B1.10.1",sub:"Mobiliario Urbano",             imp:22148492,n:6, a:0,fotos:{}},
  {sec:"B1.4",   sub:"Andador Peatonal (Calle Const.)",imp:17739848,n:8,a:0,fotos:{}},
  {sec:"A1.7.1", sub:"Terracerias",                   imp:11569121,n:8, a:0,fotos:{}},
  {sec:"B1.7B",  sub:"Sistema Infiltración y Bombeo", imp:7378421, n:4, a:0,fotos:{}},
  {sec:"B1.7",   sub:"Acceso Vehicular",              imp:7311598, n:5, a:0,fotos:{}},
  {sec:"B1.9.1", sub:"Cisterna",                      imp:6752324, n:8, a:0,fotos:{}},
  {sec:"B1.10.4",sub:"Área Skate Park",               imp:4983614, n:15,a:0,fotos:{}},
  {sec:"A1.3",   sub:"Drenaje Pluvial",               imp:4644580, n:10,a:0,fotos:{}},
  {sec:"A1.5",   sub:"Jardinería",                    imp:4248746, n:7, a:0,fotos:{}},
];

const RUBROS_GP=[
  {id:"mat",label:"Materiales",         monto:13203452,color:C.blue},
  {id:"sue",label:"Sueldos y salarios", monto:11677695,color:C.green},
  {id:"ind",label:"Indirectos",         monto:3547181, color:C.purple},
  {id:"sub",label:"Subcontratos",       monto:249500,  color:C.orange},
  {id:"maq",label:"Renta y mant. maq.", monto:652372,  color:C.yellow},
];
const PERIODOS=[
  {k:"2025",l:"2025",  a:19087948},{k:"Ene",l:"Ene 26",a:21262688},
  {k:"Feb", l:"Feb 26",a:23822336},{k:"Mar",l:"Mar 26",a:26589100},
  {k:"S14", l:"Sem 14",a:26665633},{k:"S15",l:"Sem 15",a:27062468},
  {k:"S16", l:"Sem 16",a:28277453},{k:"S17",l:"Sem 17",a:29330201},
];
const CPTS=["Anticipo","En almacén","En tránsito","En fabricación"];
const CT_COL={"Anticipo":C.yellow,"En almacén":C.green,"En tránsito":C.blue,"En fabricación":C.purple};
const EST_COL={Pagada:C.green,Facturada:C.purple,Aprobada:C.blue,"En proceso":C.yellow};

// ── PANTALLA LOGIN ─────────────────────────────────────────────────────────
function Login({onLogin}){
  const[correo,setCorreo]=useState("");
  const[pass,setPass]=useState("");
  const[error,setError]=useState("");
  const[loading,setLoading]=useState(false);

  function handleLogin(e){
    e.preventDefault();
    setLoading(true); setError("");
    setTimeout(()=>{
      const user=USUARIOS.find(u=>u.correo.toLowerCase()===correo.toLowerCase().trim()&&u.pass===pass);
      if(user){onLogin(user);}
      else{setError("Correo o contraseña incorrectos");setLoading(false);}
    },600);
  }

  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",
    alignItems:"center",justifyContent:"center",padding:24}}>
    <div style={{width:"100%",maxWidth:380}}>
      {/* Logo */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32,gap:12}}>
        <EmblemaFOSMON size={48}/>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"0.14em",color:C.caliza}}>CAMPO</div>
          <div style={{fontSize:9,color:C.textMut,letterSpacing:"0.08em",marginTop:2}}>FOSMON CONSTRUCCIONES</div>
        </div>
      </div>
      {/* Form */}
      <form onSubmit={handleLogin} style={{display:"flex",flexDirection:"column",gap:12}}>
        <div>
          <div style={{fontSize:10,color:C.textMut,marginBottom:5,letterSpacing:"0.04em"}}>CORREO CORPORATIVO</div>
          <input type="email" value={correo} onChange={e=>setCorreo(e.target.value)}
            placeholder="usuario@fosmon.com.mx"
            style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:8,
              padding:"12px 14px",color:C.textPri,fontSize:13,width:"100%",outline:"none"}}/>
        </div>
        <div>
          <div style={{fontSize:10,color:C.textMut,marginBottom:5,letterSpacing:"0.04em"}}>CONTRASEÑA</div>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
            placeholder="••••••••"
            style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:8,
              padding:"12px 14px",color:C.textPri,fontSize:13,width:"100%",outline:"none"}}/>
        </div>
        {error&&<div style={{background:"rgba(220,38,38,0.12)",border:"0.5px solid rgba(220,38,38,0.3)",
          borderRadius:7,padding:"9px 12px",fontSize:12,color:C.red}}>{error}</div>}
        <button type="submit" disabled={loading||!correo||!pass}
          style={{background:(!correo||!pass||loading)?"rgba(255,254,249,0.15)":C.caliza,
            border:"none",borderRadius:8,padding:13,color:(!correo||!pass||loading)?C.textMut:C.bg,
            fontSize:13,fontWeight:700,cursor:(!correo||!pass||loading)?"not-allowed":"pointer",
            letterSpacing:"0.04em",marginTop:4,transition:"all .2s"}}>
          {loading?"Verificando...":"Entrar a CAMPO"}
        </button>
      </form>
      <div style={{textAlign:"center",marginTop:20,fontSize:10,color:C.textMut}}>
        Control de Avance, Maquinaria, Personal y Obra
      </div>
    </div>
  </div>;
}

// ── PANTALLA OBRAS ─────────────────────────────────────────────────────────
function PantallaObras({onSelect,usuario}){
  const ec={activa:C.green,terminada:C.blue,pausada:C.yellow};
  const obras=PERMISOS[usuario.rol]?.todas_obras?_OBRAS_BASE:[_OBRAS_BASE[0]];
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{paddingBottom:10}}>
      <div style={{fontSize:15,fontWeight:700,color:C.textPri,marginBottom:3}}>
        Bienvenido, {usuario.nombre.split(" ")[0]}
      </div>
      <div style={{fontSize:11,color:C.textMut}}>
        {ROL_LABEL[usuario.rol]} · FOSMON Construcciones · {obras.length} proyecto(s)
      </div>
    </div>
    {obras.map(o=>{
      const pg=o.presupuesto>0?(o.gastoGP/o.presupuesto)*100:0;
      const col=ec[o.estado]||C.caliza;
      return <div key={o.id} onClick={()=>onSelect(o.id)}
        style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:10,
          padding:"14px 16px",cursor:"pointer",transition:"border-color .15s"}}
        onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,254,249,0.35)"}
        onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:C.textPri,marginBottom:2}}>{o.nombre}</div>
            <div style={{fontSize:10,color:C.textMut}}>{o.contrato} · {o.cliente}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0,marginLeft:10}}>
            <Bdg color={col}>{o.estado.toUpperCase()}</Bdg>
            <span style={{fontSize:9,color:C.textMut}}>Act: {o.ultimaAct}</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:9}}>
          {[["Presupuesto",MXN(o.presupuesto),C.textPri],["Gasto GP",MXN(o.gastoGP),C.red],
            ["Anticipo/FG",`${o.pctAnticipo}%/${o.pctFondoGar}%`,C.textSec]].map(([l,v,c])=>
            <div key={l}><div style={{fontSize:9,color:C.textMut,marginBottom:1}}>{l}</div>
              <div style={{fontSize:12,fontWeight:500,color:c}}>{v}</div></div>)}
        </div>
        <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:3,overflow:"hidden",marginBottom:8}}>
          <div style={{width:`${Math.min(pg,100).toFixed(1)}%`,height:"100%",
            background:`linear-gradient(90deg,${C.caliza},${C.red})`,borderRadius:99}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMut}}>
          <span>{o.superintendente}</span>
          <span style={{color:C.caliza,fontWeight:700}}>Ver obra →</span>
        </div>
      </div>;
    })}
  </div>;
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function Dashboard({obra,subs,maquinaria,materiales,estimaciones}){
  const[lbFoto,setLbFoto]=useState(null);
  const gt=obra.gastoGP+maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const am=subs.reduce((t,s)=>t+(s.a/100)*s.imp,0);
  const alm=materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const me=am+alm; const af=subs.reduce((t,s)=>t+(s.a/100)*(s.imp/obra.presupuesto)*100,0);
  const diff=me-gt; const mpct=me>0?(diff/me)*100:0; const mc=semM(mpct);
  const dir=NOMINA_S18.filter(p=>p.tipo==="D").length;
  const ind=NOMINA_S18.filter(p=>p.tipo==="I").length;
  const cE=e=>{const a=e.monto*obra.pctAnticipo/100,fg=e.monto*obra.pctFondoGar/100;return{a,fg,ef:e.monto-a-fg};};
  const estPag  =estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+cE(e).ef,0);
  const estFact =estimaciones.filter(e=>e.estatus==="Facturada").reduce((t,e)=>t+e.monto,0);
  const estRet  =estimaciones.reduce((t,e)=>t+cE(e).fg,0);
  const estAmort=estimaciones.filter(e=>e.estatus!=="Pagada").reduce((t,e)=>t+cE(e).a,0);
  const totalEst=estimaciones.reduce((t,e)=>t+e.monto,0);
  const top4=subs.slice(0,4); const maxI=top4[0]?.imp||1;
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
      <Kpi label="Avance físico"   value={`${NUM(af,1)}%`} sub="ponderado"      color={semA(af)}/>
      <Kpi label="Monto ejecutado" value={MXN(me)}         sub="avance+almacén" color={C.blue} size={12}/>
      <Kpi label="Gasto total"     value={MXN(gt)}         sub="GP+maquinaria"  color={C.red}  size={12}/>
      <Kpi label="Personal campo"  value={dir+ind}         sub={`${dir}D · ${ind}I`} color={C.green}/>
    </div>
    <Card accent={mc}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div><Tit>Margen bruto de obra</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>Monto ejecutado − Gasto total</div></div>
        <div style={{background:`${mc}22`,border:`0.5px solid ${mc}44`,borderRadius:4,
          padding:"3px 9px",fontSize:10,fontWeight:600,color:mc,whiteSpace:"nowrap"}}>
          {me===0?"Sin avance":mpct>15?"Saludable":mpct>=6?"En vigilancia":"Crítico"}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[[MXN(me),"Monto ejecutado",C.blue,"avance+almacén"],[MXN(gt),"Gasto total",C.red,"GP+maquinaria"],
          [`${diff>=0?"+":""}${MXN(diff)}`,"Diferencia",mc,`margen ${NUM(mpct,1)}%`]].map(([v,l,c,s])=>
          <div key={l} style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${c}`}}>
            <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>{l}</div>
            <div style={{fontSize:13,fontWeight:600,color:c}}>{v}</div>
            <div style={{fontSize:9,color:C.textMut}}>{s}</div>
          </div>)}
      </div>
      <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:9,overflow:"hidden",position:"relative"}}>
        <div style={{width:`${Math.min((gt/obra.presupuesto)*100,100).toFixed(1)}%`,height:"100%",
          background:`linear-gradient(90deg,${C.caliza},${C.red})`,borderRadius:99}}/>
        <div style={{position:"absolute",top:0,height:"100%",left:"85%",width:1.5,background:C.yellow}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginTop:3}}>
        <span>$0</span><span style={{color:C.yellow}}>↑ umbral 15%</span><span>{MXN(obra.presupuesto)}</span>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <Tit>Estimaciones</Tit>
        <span style={{fontSize:9,color:C.textMut}}>{estimaciones.length} est. · Amort {obra.pctAnticipo}% · FG {obra.pctFondoGar}%</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
        <Kpi label="Pagado"       value={MXN(estPag)}   sub="cobrado"    color={C.green}  size={12}/>
        <Kpi label="Por cobrar"   value={MXN(estFact)}  sub="facturadas" color={C.purple} size={12}/>
        <Kpi label="Retenido FG"  value={MXN(estRet)}   sub="fondo"      color={C.red}    size={12}/>
        <Kpi label="Por recuperar anticipo"value={MXN(estAmort)} sub="anticipo"   color={C.yellow} size={12}/>
      </div>
    </Card>
    {/* ── AVANCE VALORIZADO vs ESTIMADO ── */}
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <Tit>Avance valorizado vs Estimaciones</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>
            Obra ejecutada en campo comparada con lo facturado al cliente
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.blue}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Avance valorizado</div>
          <div style={{fontSize:13,fontWeight:700,color:C.blue}}>{MXN(am)}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{NUM(am/obra.presupuesto*100,1)}% del presupuesto</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.purple}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Estimado acumulado</div>
          <div style={{fontSize:13,fontWeight:700,color:C.purple}}>{MXN(totalEst)}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{NUM(totalEst/obra.presupuesto*100,1)}% del presupuesto</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",
          borderLeft:`3px solid ${am>=totalEst?C.green:C.yellow}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Por estimar (cobrar)</div>
          <div style={{fontSize:13,fontWeight:700,color:am>=totalEst?C.green:C.yellow}}>{MXN(Math.max(am-totalEst,0))}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>obra ejecutada sin facturar</div>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        {[
          ["Avance valorizado", am, C.blue],
          ["Estimado acumulado", totalEst, C.purple],
        ].map(([lbl,val,col])=><div key={lbl} style={{marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:3}}>
            <span>{lbl}</span>
            <span style={{color:col,fontWeight:600}}>{MXN(val)} · {NUM(val/obra.presupuesto*100,1)}%</span>
          </div>
          <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:7,overflow:"hidden"}}>
            <div style={{width:`${Math.min(val/obra.presupuesto*100,100).toFixed(1)}%`,height:"100%",
              background:col,borderRadius:99,transition:"width .5s"}}/>
          </div>
        </div>)}
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:3}}>
          <span>Presupuesto total</span>
          <span style={{color:C.caliza,fontWeight:600}}>{MXN(obra.presupuesto)} · 100%</span>
        </div>
        <div style={{background:"rgba(255,254,249,0.15)",borderRadius:99,height:7,overflow:"hidden"}}>
          <div style={{width:"100%",height:"100%",background:"rgba(255,254,249,0.1)",borderRadius:99}}/>
        </div>
      </div>
      {(()=>{
        const inicioMs=new Date(obra.inicio).getTime();
        const finMs=new Date(obra.fin).getTime();
        const hoyMs=new Date("2026-05-27").getTime();
        const plazoTotal=(finMs-inicioMs)/(1000*60*60*24);
        const plazoTrans=Math.max((hoyMs-inicioMs)/(1000*60*60*24),1);
        const plazoRest=Math.max((finMs-hoyMs)/(1000*60*60*24),0);
        const pctPlazo=Math.min(plazoTrans/plazoTotal*100,100);
        const ritmoSem=am>0&&plazoTrans>0?am/(plazoTrans/7):0;
        const semRest=plazoRest/7;
        const proyFin=am+ritmoSem*semRest;
        const pctProy=Math.min(proyFin/obra.presupuesto*100,100);
        const faltaEst=Math.max(obra.presupuesto-totalEst,0);
        const semsParaEst=ritmoSem>0?Math.ceil(faltaEst/ritmoSem):null;
        return <div style={{borderTop:`0.5px solid ${C.border}`,paddingTop:10}}>
          <div style={{fontSize:9,color:C.textMut,fontWeight:600,textTransform:"uppercase",
            letterSpacing:"0.05em",marginBottom:8}}>Proyección al término de obra</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
            {[
              ["Plazo transcurrido", `${NUM(pctPlazo,0)}%`, `${Math.round(plazoTrans)} de ${plazoTotal} días`, C.caliza],
              ["Ritmo semanal", MXN(ritmoSem), "avance / semana", C.blue],
              ["Proyección al fin", `${NUM(pctProy,1)}%`, MXN(proyFin)+" proyectado", pctProy>=95?C.green:pctProy>=75?C.yellow:C.red],
              ["Semanas p/ estimar", semsParaEst?`~${semsParaEst} sem`:"—", MXN(faltaEst)+" por estimar", semsParaEst&&semsParaEst<=semRest?C.green:C.yellow],
            ].map(([l,v,s,c])=><div key={l} style={{background:C.bg,borderRadius:7,padding:"8px 10px"}}>
              <div style={{fontSize:8,color:C.textMut,marginBottom:3}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:2}}>{s}</div>
            </div>)}
          </div>
          {pctProy<95?<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.25)",
            borderRadius:7,padding:"7px 10px",fontSize:10,color:C.yellow}}>
            ⚠ Al ritmo actual la obra terminaría al <b>{NUM(pctProy,1)}%</b> del presupuesto.
            Se requiere acelerar <b>{MXN((obra.presupuesto-proyFin)/Math.max(semRest,1))}/sem</b> adicionales.
          </div>:<div style={{background:"rgba(22,163,74,0.1)",border:"0.5px solid rgba(22,163,74,0.25)",
            borderRadius:7,padding:"7px 10px",fontSize:10,color:C.green}}>
            ✓ Al ritmo actual la obra termina dentro del presupuesto contratado.
          </div>}
        </div>;
      })()}
    </Card>

    <Card>
      <Tit>Personal en campo — Semana 18</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        <Kpi label="Total"     value={dir+ind} sub="trabajadores"  color={C.caliza}/>
        <Kpi label="Directo"   value={dir}     sub="mano de obra"  color={C.blue}/>
        <Kpi label="Indirecto" value={ind}     sub="administración"color={C.purple}/>
      </div>
    </Card>
    {lbFoto&&<Lightbox url={lbFoto} onClose={()=>setLbFoto(null)}/>}
    <Card>
      <Tit>Top subsecciones — avance y evidencia</Tit>
      {top4.map((s,i)=>{
        const fotos=(CATALOGO[s.sec]?.conceptos||[]).flatMap(c=>c.fotos||[]);
        const mostrar=fotos.slice(0,2);
        return <div key={s.sec} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,gap:6}}>
            <span style={{display:"flex",alignItems:"center",gap:4,minWidth:0,overflow:"hidden"}}>
              <span style={{color:C.textMut,flexShrink:0}}>{i+1}</span>
              <span style={{color:C.caliza,fontWeight:700,flexShrink:0,fontSize:10}}>{s.sec}</span>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.textSec}}>{s.sub}</span>
            </span>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <Bdg color={semA(s.a)} small>{s.a}%</Bdg>
              <span style={{fontWeight:600,fontSize:11,color:C.textPri}}>{MXN(s.imp)}</span>
            </div>
          </div>
          <Bar pct={(s.imp/maxI)*100} color="rgba(255,254,249,0.3)"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:7}}>
            {[0,1].map(fi=>{
              const foto=mostrar[fi];
              if(foto)return <div key={fi} style={{borderRadius:6,overflow:"hidden",aspectRatio:"16/9",cursor:"zoom-in"}}
                onClick={()=>setLbFoto(foto.url)}>
                <img src={foto.url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>;
              return <div key={fi} style={{borderRadius:6,aspectRatio:"16/9",
                background:"rgba(255,254,249,0.04)",border:"1px dashed rgba(255,254,249,0.12)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}>
                <span style={{fontSize:16,opacity:0.3}}>📷</span>
                <span style={{fontSize:8,color:C.textMut}}>Sin foto</span>
              </div>;
            })}
          </div>
        </div>;
      })}
      <div style={{fontSize:9,color:C.textMut,textAlign:"center",marginTop:4}}>
        Agrega fotos en Capturar avance → Volúmenes
      </div>
    </Card>
  </div>;
}

// ── CAPTURA ────────────────────────────────────────────────────────────────
function Captura({subs,setSubs,maquinaria,setMaquinaria,materiales,setMateriales,rol}){
  const[tab,setTab]=useState("volumenes");
  const[exp,setExp]=useState({});
  const editar=can(rol,"captura","editar");
  const addFoto=(sec,foto)=>setSubs(ss=>ss.map(s=>s.sec===sec?{...s,fotos:{...s.fotos,[sec]:[...(s.fotos[sec]||[]),foto]}}:s));
  const delFoto=(sec,id)=>setSubs(ss=>ss.map(s=>s.sec===sec?{...s,fotos:{...s.fotos,[sec]:(s.fotos[sec]||[]).filter(f=>f.id!==id)}}:s));
  const rMaq=(i,f,v)=>setMaquinaria(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));
  const rMat=(i,f,v)=>setMateriales(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
      🔒 Vista de solo lectura — tu rol no tiene permiso para editar este módulo.
    </div>}
    <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0,paddingBottom:1}}>
      {[["volumenes","📐 Volúmenes"],["maquinaria","🚜 Maquinaria"],["materiales","📦 Almacén"],["personal","👷 Personal"]].map(([id,lbl])=>
        <button key={id} onClick={()=>setTab(id)} style={{flex:"0 0 auto",padding:"7px 14px",fontSize:11,borderRadius:8,
          background:tab===id?C.caliza:C.card,border:`0.5px solid ${tab===id?C.caliza:C.border}`,
          color:tab===id?C.bg:C.textSec,fontWeight:tab===id?700:400,whiteSpace:"nowrap"}}>{lbl}</button>)}
    </div>

    {tab==="volumenes"&&<Card>
      <Tit>Avance por subsección</Tit>
      {subs.map(s=>{
        const nF=(s.fotos[s.sec]||[]).length;
        return <div key={s.sec} style={{background:C.bg,borderRadius:8,padding:"8px 10px",marginBottom:5}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div style={{flex:1,cursor:"pointer",minWidth:0,overflow:"hidden"}} onClick={()=>setExp(e=>({...e,[s.sec]:!e[s.sec]}))}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:C.caliza}}>{exp[s.sec]?"▾":"▸"}</span>
                <span style={{fontSize:9,fontWeight:700,color:C.caliza}}>{s.sec}</span>
                <span style={{fontSize:11,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.sub}</span>
                {nF>0&&<Bdg color={C.purple} small>📷{nF}</Bdg>}
              </div>
              <div style={{fontSize:9,color:C.textMut,marginTop:1,marginLeft:12}}>{s.n} conceptos · {MXN(s.imp)}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,marginLeft:8}}>
              {editar?<><input type="number" min="0" max="100" placeholder="0" value={s.a||""}
                onChange={e=>setSubs(ss=>ss.map(x=>x.sec===s.sec?{...x,a:Math.min(100,Math.max(0,parseFloat(e.target.value)||0))}:x))}
                style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                  padding:"3px 6px",fontSize:12,width:50,textAlign:"right",color:C.textPri,outline:"none"}}/>
              <span style={{fontSize:10,color:C.textMut}}>%</span></>
              :<span style={{fontSize:13,fontWeight:700,color:semA(s.a||0)}}>{s.a||0}%</span>}
            </div>
          </div>
          <Bar pct={s.a||0} color={semA(s.a||0)}/>
          {exp[s.sec]&&<div style={{marginTop:9,borderTop:`0.5px solid ${C.border}`,paddingTop:9}}>
            <div style={{fontSize:9,color:C.textMut,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
              Conceptos — {s.sec} ({(CATALOGO[s.sec]?.conceptos||[]).length} partidas)
            </div>
            {(CATALOGO[s.sec]?.conceptos||[]).map((c,ci)=>(
              <div key={c.clave} style={{background:C.card,borderRadius:7,padding:"8px 10px",marginBottom:5,borderLeft:`2px solid ${semA(c.avance)}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:8,color:C.textMut,marginBottom:2,fontFamily:"monospace"}}>{c.clave}</div>
                    <div style={{fontSize:10,color:C.textSec,lineHeight:1.3}}>{c.desc}</div>
                    <div style={{fontSize:9,color:C.textMut,marginTop:3}}>{c.unidad} · {c.cantidad.toLocaleString("es-MX")} uds</div>
                  </div>
                  <div style={{flexShrink:0,textAlign:"right"}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(c.importe)}</div>
                    <div style={{fontSize:8,color:semA(c.avance),marginTop:2,fontWeight:600}}>{c.avance}%</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <div style={{flex:1,background:"rgba(255,254,249,0.08)",borderRadius:99,height:4,overflow:"hidden"}}>
                    <div style={{width:`${c.avance}%`,height:"100%",background:semA(c.avance),borderRadius:99,transition:"width .3s"}}/>
                  </div>
                  {editar&&<><input type="number" min="0" max="100" placeholder="0" value={c.avance||""}
                    onChange={e=>{
                      const val=Math.min(100,Math.max(0,parseFloat(e.target.value)||0));
                      const cat=CATALOGO[s.sec];if(cat)cat.conceptos[ci].avance=val;
                      const conceptos=CATALOGO[s.sec]?.conceptos||[];
                      const totalImp=conceptos.reduce((t,x)=>t+x.importe,0);
                      const avSub=totalImp>0?conceptos.reduce((t,x)=>t+(x.avance/100)*x.importe,0)/totalImp*100:0;
                      setSubs(ss=>ss.map(x=>x.sec===s.sec?{...x,a:Math.round(avSub*10)/10}:x));
                    }}
                    style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:5,
                      padding:"2px 5px",fontSize:11,width:44,textAlign:"right",color:C.textPri,outline:"none"}}/>
                  <span style={{fontSize:9,color:C.textMut}}>%</span></>}
                </div>
                {editar&&<ConceptoFotos fotos={c.fotos}
                  onAdd={foto=>{const cat=CATALOGO[s.sec];if(cat){cat.conceptos[ci].fotos=[...cat.conceptos[ci].fotos,foto];}setSubs(ss=>[...ss]);}}
                  onDel={id=>{const cat=CATALOGO[s.sec];if(cat){cat.conceptos[ci].fotos=cat.conceptos[ci].fotos.filter(f=>f.id!==id);}setSubs(ss=>[...ss]);}}/>}
              </div>
            ))}
          </div>}
        </div>;
      })}
    </Card>}

    {tab==="maquinaria"&&<Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Maquinaria propia en obra</Tit>
        <span style={{fontSize:9,color:C.textMut}}>Suma al gasto</span>
      </div>
      {maquinaria.map((m,i)=><div key={m.id} style={{background:C.bg,borderRadius:7,padding:"8px 10px",marginBottom:5}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <span style={{fontSize:10,color:C.textMut,width:18,textAlign:"center",flexShrink:0}}>{i+1}</span>
          {editar?<Inp placeholder="Descripción..." value={m.desc} style={{flex:1,fontSize:10}}
            onChange={e=>setMaquinaria(mm=>mm.map((x,j)=>j===i?{...x,desc:e.target.value}:x))}/>
          :<span style={{flex:1,fontSize:10,color:C.textSec}}>{m.desc||"—"}</span>}
          {editar&&<button onClick={()=>setMaquinaria(mm=>mm.filter((_,j)=>j!==i))}
            style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1,flexShrink:0}}>×</button>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
          {[["Volumen","number",m.vol,"vol"],["Unidad","text",m.und,"und"],["P.U.","number",m.pu,"pu"]].map(([l,type,val,field])=>
            <div key={l}>
              <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>{l}</div>
              {editar?<Inp type={type} min="0" placeholder={type==="number"?"0":"Mes"} value={val}
                style={{textAlign:type==="number"?"right":"left",fontSize:11}}
                onChange={e=>rMaq(i,field,e.target.value)}/>
              :<div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{val||"—"}</div>}
            </div>)}
          <div>
            <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Importe</div>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
              padding:"5px 7px",fontSize:12,fontWeight:700,color:C.orange,textAlign:"right"}}>{MXN(m.imp)}</div>
          </div>
        </div>
      </div>)}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`}}>
        {editar&&<SecBtn onClick={()=>setMaquinaria(mm=>[...mm,{id:Date.now(),desc:"",vol:"",und:"Mes",pu:"",imp:0}])}>+ Agregar</SecBtn>}
        <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginLeft:"auto"}}>
          Total: <span style={{color:C.orange}}>{MXN(maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0))}</span>
        </div>
      </div>
    </Card>}

    {tab==="materiales"&&<Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Materiales en almacén</Tit>
        <span style={{fontSize:9,color:C.textMut}}>Suma al monto ejecutado</span>
      </div>
      {materiales.map((m,i)=>{
        const cc=m.concepto||"En almacén";
        return <div key={m.id} style={{background:C.bg,borderRadius:7,padding:"8px 10px",marginBottom:5,borderLeft:`2px solid ${CT_COL[cc]}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:10,color:C.textMut,width:18,textAlign:"center",flexShrink:0}}>{i+1}</span>
            {editar?<Inp placeholder="Descripción..." value={m.desc} style={{flex:1,fontSize:10}}
              onChange={e=>setMateriales(mm=>mm.map((x,j)=>j===i?{...x,desc:e.target.value}:x))}/>
            :<span style={{flex:1,fontSize:10,color:C.textSec}}>{m.desc||"—"}</span>}
            {editar?<Sel value={cc} style={{fontSize:10,padding:"5px 6px",flexShrink:0,width:110}}
              onChange={e=>setMateriales(mm=>mm.map((x,j)=>j===i?{...x,concepto:e.target.value}:x))}>
              {CPTS.map(c=><option key={c} value={c}>{c}</option>)}
            </Sel>:<Bdg color={CT_COL[cc]} small>{cc}</Bdg>}
            {editar&&<button onClick={()=>setMateriales(mm=>mm.filter((_,j)=>j!==i))}
              style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1,flexShrink:0}}>×</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[["Volumen","number",m.vol,"vol"],["Unidad","text",m.und,"und"],["P.U.","number",m.pu,"pu"]].map(([l,type,val,field])=>
              <div key={l}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>{l}</div>
                {editar?<Inp type={type} min="0" placeholder="0" value={val}
                  style={{textAlign:type==="number"?"right":"left",fontSize:11}}
                  onChange={e=>rMat(i,field,e.target.value)}/>
                :<div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{val||"—"}</div>}
              </div>)}
            <div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Importe</div>
              <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
                padding:"5px 7px",fontSize:12,fontWeight:700,color:CT_COL[cc]||C.blue,textAlign:"right"}}>{MXN(m.imp)}</div>
            </div>
          </div>
        </div>;
      })}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`}}>
        {editar&&<SecBtn onClick={()=>setMateriales(mm=>[...mm,{id:Date.now(),desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0}])}>+ Agregar</SecBtn>}
        <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginLeft:"auto"}}>
          Total: <span style={{color:C.blue}}>{MXN(materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0))}</span>
        </div>
      </div>
    </Card>}

    {tab==="personal"&&<Card>
      <Tit>Personal en campo — Semana 18 (23–29 Abr 2026)</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:12}}>
        <Kpi label="Total" value={NOMINA_S18.length} sub="trabajadores" color={C.caliza}/>
        <Kpi label="Directo" value={NOMINA_S18.filter(p=>p.tipo==="D").length} sub="mano de obra" color={C.blue}/>
        <Kpi label="Indirecto" value={NOMINA_S18.filter(p=>p.tipo==="I").length} sub="administración" color={C.purple}/>
        <Kpi label="Horas extra" value={`${NOMINA_S18.reduce((t,p)=>t+p.horasExtra,0).toFixed(0)}hrs`}
          sub={MXN(NOMINA_S18.reduce((t,p)=>t+p.importeHE,0))} color={C.orange}/>
      </div>
      <div style={{fontSize:9,color:C.textMut,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
        Lista de personal
      </div>
      {NOMINA_S18.slice().sort((a,b)=>b.total-a.total).map((p,i)=>
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,
          marginBottom:4,alignItems:"center",padding:"5px 0",
          borderBottom:`0.5px solid ${C.border}`}}>
          <div>
            <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
            <div style={{fontSize:9,color:C.textMut}}>{p.categoria}</div>
          </div>
          <Bdg color={p.tipo==="D"?C.blue:C.purple} small>{p.tipo==="D"?"Directo":"Indirecto"}</Bdg>
          {p.horasExtra>0&&<Bdg color={C.orange} small>HE: {p.horasExtra}hrs</Bdg>}
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(p.total)}</div>
            {p.horasExtra>0&&<div style={{fontSize:8,color:C.orange}}>+{MXN(p.importeHE)} HE</div>}
          </div>
        </div>)}
    </Card>}

    {editar&&<PrimaryBtn onClick={()=>alert("✓ Registro guardado correctamente")}>GUARDAR REGISTRO</PrimaryBtn>}
  </div>;
}

// ── GASTOS GP ──────────────────────────────────────────────────────────────
function GastosGP({obra,maquinaria,rol}){
  const[idx,setIdx]=useState(7);
  const cur=PERIODOS[idx]; const prev=idx>0?PERIODOS[idx-1]:null;
  const delta=prev?cur.a-prev.a:cur.a;
  const maxD=Math.max(...PERIODOS.map((_,i)=>i>0?PERIODOS[i].a-PERIODOS[i-1].a:PERIODOS[0].a));
  const totalGP=RUBROS_GP.reduce((t,r)=>t+r.monto,0);
  const totalMaq=maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
      <Kpi label="Gasto GP Construct" value={MXN(totalGP)}   sub="acumulado GP"  color={C.red}    size={12}/>
      <Kpi label="Maquinaria propia"  value={MXN(totalMaq)}  sub="equipo FOSMON" color={C.orange} size={12}/>
      <Kpi label="Gasto total obra"   value={MXN(totalGP+totalMaq)} sub="GP+maquinaria" color={C.textPri} size={12}/>
      <Kpi label="% del presupuesto"  value={`${NUM((totalGP+totalMaq)/obra.presupuesto*100,1)}%`} sub="del contrato" color={C.yellow}/>
    </div>
    <Card>
      <Tit>Desglose acumulado por rubro</Tit>
      {RUBROS_GP.map(r=>{
        const pctGP=totalGP>0?r.monto/totalGP*100:0;
        return <div key={r.id} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:6}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:r.color,flexShrink:0}}/>
              <span style={{fontSize:11,color:C.textSec}}>{r.label}</span>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
              <span style={{fontSize:9,color:C.textMut}}>{NUM(pctGP,1)}% del GP</span>
              <span style={{fontSize:12,fontWeight:600,color:r.color}}>{MXN(r.monto)}</span>
            </div>
          </div>
          <Bar pct={pctGP} color={r.color}/>
        </div>;
      })}
      <div style={{marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:10,color:C.textMut}}>TOTAL GASTO ACUMULADO</span>
        <span style={{fontSize:14,fontWeight:700,color:C.textPri}}>{MXN(totalGP+totalMaq)}</span>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Evolución acumulada — GP Construct</Tit>
        <span style={{fontSize:9,color:C.caliza,fontWeight:600}}>Act: {obra.ultimaAct}</span>
      </div>
      <input type="range" min="0" max={PERIODOS.length-1} value={idx} step="1"
        style={{marginBottom:5}} onChange={e=>setIdx(parseInt(e.target.value))}/>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        {PERIODOS.map((p,i)=><span key={p.k} onClick={()=>setIdx(i)} style={{fontSize:8,cursor:"pointer",
          color:i===idx?C.caliza:"rgba(255,254,249,0.3)",fontWeight:i===idx?600:400}}>{p.l}</span>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
        {[[`Acum. al ${cur.l}`,MXN(cur.a),C.red],["Gasto período",MXN(delta),C.caliza],
          ["% del total GP",`${NUM(cur.a/totalGP*100,1)}%`,C.purple]].map(([l,v,c])=>
          <div key={l} style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${c}`}}>
            <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>{l}</div>
            <div style={{fontSize:14,fontWeight:600,color:c}}>{v}</div>
          </div>)}
      </div>
      {PERIODOS.map((p,i)=>{
        const d=i>0?p.a-PERIODOS[i-1].a:p.a;
        return <div key={p.k} style={{marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3,gap:6}}>
            <span style={{color:i===idx?C.caliza:"rgba(255,254,249,0.5)",fontWeight:i===idx?600:400}}>{p.l}</span>
            <span style={{fontWeight:600,color:C.caliza}}>{MXN(d)}</span>
          </div>
          <Bar pct={d/maxD*100} color={i===idx?C.caliza:"rgba(255,254,249,0.2)"}/>
        </div>;
      })}
    </Card>
  </div>;
}

// ── ESTIMACIONES ───────────────────────────────────────────────────────────
function Estimaciones({obra,setObra,estimaciones,setEstimaciones,rol}){
  const[saved,setSaved]=useState(false);
  const editar=can(rol,"estimaciones","editar");
  const ESTATUS=["En proceso","Aprobada","Facturada","Pagada"];
  const cE=e=>{const a=e.monto*obra.pctAnticipo/100,fg=e.monto*obra.pctFondoGar/100;return{a,fg,ef:e.monto-a-fg,pC:e.monto/obra.presupuesto*100};};
  const totalEst  =estimaciones.reduce((t,e)=>t+e.monto,0);
  const pagado    =estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+cE(e).ef,0);
  const facturado =estimaciones.filter(e=>e.estatus==="Facturada").reduce((t,e)=>t+e.monto,0);
  const enProceso =estimaciones.filter(e=>e.estatus==="En proceso").reduce((t,e)=>t+e.monto,0);
  const retenido  =estimaciones.reduce((t,e)=>t+cE(e).fg,0);
  const porAmort  =estimaciones.filter(e=>e.estatus!=="Pagada").reduce((t,e)=>t+cE(e).a,0);
  const porEstimar=obra.presupuesto-totalEst;
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
      🔒 Vista de solo lectura — tu rol no permite editar estimaciones.
    </div>}
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <Tit>Configuración del contrato</Tit>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["Anticipo",obra.pctAnticipo,v=>{const upd={...obra,pctAnticipo:parseFloat(v)||0};setObra(upd);try{localStorage.setItem(`campo_obra_${obra.id}`,JSON.stringify({pctAnticipo:upd.pctAnticipo,pctFondoGar:upd.pctFondoGar}));}catch{}}],
            ["Fondo garantía",obra.pctFondoGar,v=>{const upd={...obra,pctFondoGar:parseFloat(v)||0};setObra(upd);try{localStorage.setItem(`campo_obra_${obra.id}`,JSON.stringify({pctAnticipo:upd.pctAnticipo,pctFondoGar:upd.pctFondoGar}));}catch{}}]].map(([l,v,s])=>
            <div key={l} style={{display:"flex",alignItems:"center",gap:6,background:C.bg,borderRadius:6,padding:"5px 10px",border:`0.5px solid ${C.border}`}}>
              <span style={{fontSize:10,color:C.textMut}}>{l}</span>
              {editar?<input type="number" min="0" max="100" value={v} onChange={e=>s(e.target.value)}
                style={{background:"transparent",border:`0.5px solid ${C.borderM}`,borderRadius:4,
                  padding:"3px 5px",color:C.textPri,fontSize:11,width:38,textAlign:"right",outline:"none"}}/>
              :<span style={{fontSize:12,fontWeight:700,color:C.textPri,minWidth:28}}>{v}%</span>}
              <span style={{fontSize:10,color:C.textMut}}>%</span>
            </div>)}
        </div>
      </div>
    </Card>
    <Card>
      <Tit>Resumen económico — 7 indicadores</Tit>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:7}}>
        <Kpi label="Total estimado"  value={MXN(totalEst)}   sub={`${NUM(totalEst/obra.presupuesto*100,1)}% contrato`} color={C.caliza} size={12}/>
        <Kpi label="Pagado"          value={MXN(pagado)}     sub="cobrado"            color={C.green}  size={12}/>
        <Kpi label="Facturado"       value={MXN(facturado)}  sub="pendiente de cobro" color={C.purple} size={12}/>
        <Kpi label="En proceso"      value={MXN(enProceso)}  sub="en elaboración"     color={C.yellow} size={12}/>
        <Kpi label="Retenido FG"     value={MXN(retenido)}   sub={`fondo ${obra.pctFondoGar}%`} color={C.red}    size={12}/>
        <Kpi label="Por recuperar anticipo"   value={MXN(porAmort)}   sub={`anticipo ${obra.pctAnticipo}%`} color={C.orange} size={12}/>
        <Kpi label="Por estimar"     value={MXN(porEstimar)} sub="saldo del contrato"  color={C.indigo} size={12}/>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <Tit>Relación de estimaciones</Tit>
        <div style={{display:"flex",gap:6}}>
        {editar&&<SecBtn onClick={()=>setEstimaciones(es=>[...es,{no:(es.length>0?Math.max(...es.map(e=>e.no)):0)+1,monto:0,periodo:"",estatus:"En proceso"}])}>+ Nueva estimación</SecBtn>}
        {editar&&<button onClick={()=>{
          try{
            localStorage.setItem("campo_estimaciones_OAX01",JSON.stringify(estimaciones));
            localStorage.setItem(`campo_obra_${obra.id}`,JSON.stringify({pctAnticipo:obra.pctAnticipo,pctFondoGar:obra.pctFondoGar}));
            setSaved(true); setTimeout(()=>setSaved(false),2500);
          }catch(e){alert("Error al guardar");}
        }} style={{background:saved?C.green:C.caliza,border:"none",borderRadius:6,
          padding:"5px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",
          transition:"background .3s",display:"flex",alignItems:"center",gap:5}}>
          {saved?"✓ Guardado":"💾 Guardar cambios"}
        </button>}
      </div>
      </div>
      {estimaciones.map((e,i)=>{
        const c=cE(e); const ecol=EST_COL[e.estatus]||C.yellow;
        return <div key={e.no} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,borderLeft:`3px solid ${ecol}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8}}>
            <span style={{fontSize:13,fontWeight:700,color:C.caliza,letterSpacing:"0.06em"}}>EST-0{e.no}</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {editar?<Sel value={e.estatus} style={{fontSize:10,padding:"4px 6px"}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,estatus:ev.target.value}:x))}>
                {ESTATUS.map(s=><option key={s} value={s}>{s}</option>)}
              </Sel>:<Bdg color={ecol}>{e.estatus}</Bdg>}
              <Bdg color={ecol} small>{e.estatus}</Bdg>
              {editar&&<button onClick={()=>setEstimaciones(es=>es.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1}}>×</button>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Monto bruto</div>
              {editar?<Inp type="number" value={e.monto} style={{fontSize:12,fontWeight:600,color:C.caliza}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,monto:parseFloat(ev.target.value)||0}:x))}/>
              :<div style={{fontSize:14,fontWeight:700,color:C.caliza}}>{MXN(e.monto)}</div>}
            </div>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Período</div>
              {editar?<Inp type="text" value={e.periodo||""} placeholder="01–31 May 2026" style={{fontSize:11}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,periodo:ev.target.value}:x))}/>
              :<div style={{fontSize:12,color:C.textSec,padding:"5px 0"}}>{e.periodo||"—"}</div>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
            {[[`Anticip. (${obra.pctAnticipo}%)`,MXN(c.a),C.yellow],[`FG (${obra.pctFondoGar}%)`,MXN(c.fg),C.red],
              ["Monto efectivo",MXN(c.ef),C.green],["% contrato",`${NUM(c.pC,2)}%`,C.caliza]].map(([l,v,col])=>
              <div key={l}>
                <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>{l}</div>
                <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
                  padding:"5px 8px",fontSize:12,fontWeight:600,color:col}}>{v}</div>
              </div>)}
          </div>
        </div>;
      })}
    </Card>
  </div>;
}

// ── RIESGO ─────────────────────────────────────────────────────────────────
function Riesgo({obra,subs,maquinaria,materiales,estimaciones}){
  const gt=obra.gastoGP+maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const am=subs.reduce((t,s)=>t+(s.a/100)*s.imp,0);
  const me=am+materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const af=subs.reduce((t,s)=>t+(s.a/100)*(s.imp/obra.presupuesto)*100,0);
  const pctGasto=gt/obra.presupuesto*100;
  const brecha=pctGasto-af;
  const pctPlazo=19.6;
  const burnRate=pctGasto/pctPlazo;
  const totalEst=estimaciones.reduce((t,e)=>t+e.monto,0);
  const sinCobrar=estimaciones.filter(e=>e.estatus==="Facturada"||e.estatus==="En proceso").reduce((t,e)=>t+e.monto,0);
  const pctSinCob=totalEst>0?sinCobrar/totalEst*100:0;
  const sinIniciar=subs.filter(s=>s.a===0);
  const PROVS=[{p:"FOSMON CONSTRUCCIONES S.A.",gt:4280794},{p:"JUAN ANTONIO BENITEZ F.",gt:2412104},
    {p:"CEMEX S A B DE C V",gt:1817638},{p:"IMSS",gt:1636496},{p:"JOSE E. ALEGRIA CUETO",gt:1426787},
    {p:"RAUL CUEVAS TORRES",gt:1407121},{p:"MATERIALES RABAN DE OAXACA",gt:1038214},{p:"CONSTRUCCIONES KAYT",gt:998185}];
  const totProv=PROVS.reduce((t,p)=>t+p.gt,0);
  const top3pct=PROVS.slice(0,3).reduce((t,p)=>t+p.gt,0)/totProv*100;

  // ── NÓMINA RISK ─────────────────────────────────────────────────────────
  // Total nómina S18
  const totalNom=NOMINA_S18.reduce((t,p)=>t+p.total,0);
  const totalHE=NOMINA_S18.reduce((t,p)=>t+p.importeHE,0);
  const pctHE=totalNom>0?totalHE/totalNom*100:0;
  // Personas con HE > 20 hrs (riesgo fatiga/costo)
  const altasHE=NOMINA_S18.filter(p=>p.horasExtra>=20);
  // Personas con salario total > 2x su salario base (posible error o caso especial)
  const anomalias=NOMINA_S18.filter(p=>p.total>p.salarioSemanal*2.5&&p.salarioSemanal>0);
  // Semana simulada anterior (S17) — reducción del 15% para comparar
  const nomS17_total=totalNom*0.87;
  const deltaNom=totalNom-nomS17_total;
  const pctDeltaNom=nomS17_total>0?deltaNom/nomS17_total*100:0;

  const indicadores=[
    {num:1,titulo:"Brecha avance vs gasto",color:brecha<5?C.green:brecha<15?C.yellow:C.red,
     valor:`${brecha>=0?"+":""}${NUM(brecha,1)}pp`,
     detalle:brecha<5?"Avance y gasto alineados":brecha<15?"Gasto ligeramente adelantado al avance":"Gasto supera avance — riesgo de sobrecosto",
     extra:`Avance físico: ${NUM(af,1)}% | Gasto consumido: ${NUM(pctGasto,1)}% del presupuesto`},
    {num:2,titulo:"Velocidad de quema de presupuesto",color:burnRate<0.9?C.green:burnRate<1.2?C.yellow:C.red,
     valor:`${NUM(burnRate,2)}x`,
     detalle:burnRate<0.9?"Ritmo de gasto dentro del programa":burnRate<1.2?"Ritmo ligeramente acelerado":"Ritmo de gasto excede el programa",
     extra:`${NUM(pctPlazo,0)}% del plazo transcurrido | ${NUM(pctGasto,1)}% del presupuesto gastado`},
    {num:3,titulo:"Estimaciones pendientes de cobro",color:pctSinCob<30?C.green:pctSinCob<60?C.yellow:C.red,
     valor:`${NUM(pctSinCob,0)}%`,
     detalle:pctSinCob<30?"Flujo de cobro saludable":pctSinCob<60?"Monto significativo pendiente":"Más del 60% sin cobrar — riesgo de flujo",
     extra:`${MXN(sinCobrar)} sin cobrar de ${MXN(totalEst)} estimados`},
    {num:4,titulo:"Frentes sin iniciar",color:sinIniciar.length===0?C.green:sinIniciar.length<=2?C.yellow:C.red,
     valor:String(sinIniciar.length),
     detalle:sinIniciar.length===0?"Todos los frentes han iniciado":`${sinIniciar.length} subsección(es) con avance = 0%`,
     extra:sinIniciar.length>0?`Sin iniciar: ${sinIniciar.map(s=>s.sec).join(", ")}`:"Todos los frentes activos"},
    {num:5,titulo:"Concentración de proveedores",color:top3pct<40?C.green:top3pct<55?C.yellow:C.red,
     valor:`${NUM(top3pct,0)}%`,
     detalle:top3pct<40?"Bien diversificado":top3pct<55?"Concentración moderada — monitorear":"Concentración alta — diversificar",
     extra:`Top 3 proveedores = ${NUM(top3pct,1)}% del gasto registrado`},
    {num:6,titulo:"Incremento de nómina semana sobre semana",color:pctDeltaNom<5?C.green:pctDeltaNom<15?C.yellow:C.red,
     valor:`+${NUM(pctDeltaNom,1)}%`,
     detalle:pctDeltaNom<5?"Nómina estable entre semanas":pctDeltaNom<15?"Incremento moderado — revisar horas extra":"Incremento alto — verificar altas y horas extraordinarias",
     extra:`S17: ${MXN(nomS17_total)} → S18: ${MXN(totalNom)} | Incremento: ${MXN(deltaNom)}`},
    {num:7,titulo:"Trabajadores con horas extra excesivas (≥20hrs)",color:altasHE.length===0?C.green:altasHE.length<=5?C.yellow:C.red,
     valor:String(altasHE.length),
     detalle:altasHE.length===0?"Sin casos de horas extra excesivas":altasHE.length<=5?"Casos moderados — monitorear fatiga y costo":"Múltiples trabajadores con HE excesivas — revisar organización de turnos",
     extra:altasHE.slice(0,3).map(p=>`${p.nombre.split(" ")[0]}: ${p.horasExtra}hrs`).join(" · ")+(altasHE.length>3?` · y ${altasHE.length-3} más`:"")},
  ];

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {indicadores.map(ind=>
      <Card key={ind.num} accent={ind.color}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:9,color:C.textMut,flexShrink:0}}>RIESGO {ind.num}</span>
              <span style={{fontSize:11,fontWeight:600,color:C.textPri}}>{ind.titulo}</span>
            </div>
            <div style={{fontSize:10,color:C.textSec,marginBottom:5}}>{ind.detalle}</div>
            <div style={{fontSize:9,color:C.textMut,lineHeight:1.5}}>{ind.extra}</div>
          </div>
          <div style={{flexShrink:0,textAlign:"right"}}>
            <div style={{fontSize:22,fontWeight:700,color:ind.color,lineHeight:1}}>{ind.valor}</div>
            <div style={{fontSize:8,color:ind.color,marginTop:3,fontWeight:600,textTransform:"uppercase"}}>
              {ind.color===C.green?"Normal":ind.color===C.yellow?"Vigilancia":"Crítico"}
            </div>
          </div>
        </div>
        <div style={{height:4,borderRadius:99,background:"rgba(255,254,249,0.08)",overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:99,background:ind.color,
            width:ind.color===C.green?"33%":ind.color===C.yellow?"66%":"100%",transition:"width .4s"}}/>
        </div>
      </Card>)}

    {/* Detalle nómina */}
    <Card>
      <Tit>Detalle de nómina — Top 10 por costo total S18</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,marginBottom:6,
        padding:"0 4px 6px",borderBottom:`0.5px solid ${C.border}`}}>
        {["Trabajador","HE hrs","Tipo","Total"].map(h=>
          <div key={h} style={{fontSize:9,color:C.textMut,fontWeight:600}}>{h}</div>)}
      </div>
      {NOMINA_S18.slice().sort((a,b)=>b.total-a.total).slice(0,10).map((p,i)=>
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,
          marginBottom:5,alignItems:"center"}}>
          <div>
            <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
            <div style={{fontSize:9,color:C.textMut}}>{p.categoria}</div>
          </div>
          <div style={{fontSize:11,fontWeight:600,color:p.horasExtra>=20?C.red:p.horasExtra>0?C.orange:C.textMut,textAlign:"center"}}>
            {p.horasExtra>0?`${p.horasExtra}hrs`:"—"}
          </div>
          <Bdg color={p.tipo==="D"?C.blue:C.purple} small>{p.tipo==="D"?"D":"I"}</Bdg>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(p.total)}</div>
            {p.importeHE>0&&<div style={{fontSize:8,color:C.orange}}>+{MXN(p.importeHE)}</div>}
          </div>
        </div>)}
    </Card>

    <Card>
      <Tit>Top proveedores — concentración</Tit>
      {PROVS.map((pv,i)=><div key={pv.p} style={{marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,fontSize:11,gap:6}}>
          <span style={{display:"flex",alignItems:"center",gap:5,minWidth:0,overflow:"hidden"}}>
            <span style={{color:C.textMut,flexShrink:0}}>{i+1}</span>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.textSec}}>{pv.p}</span>
          </span>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <span style={{fontSize:9,color:C.textMut}}>{NUM(pv.gt/totProv*100,1)}%</span>
            <span style={{fontWeight:600,fontSize:11,color:C.textPri}}>{MXN(pv.gt)}</span>
          </div>
        </div>
        <Bar pct={pv.gt/PROVS[0].gt*100} color={i<3?C.red:`${C.red}55`}/>
      </div>)}
    </Card>
  </div>;
}

// ── APP PRINCIPAL ──────────────────────────────────────────────────────────
const TABS_POR_ROL = {
  director_general:    [{id:"dash",label:"Dashboard"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"}],
  director_operaciones:[{id:"dash",label:"Dashboard"},{id:"captura",label:"Capturar avance"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"}],
  gerente_construccion:[{id:"dash",label:"Dashboard"},{id:"captura",label:"Capturar avance"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"}],
  administrador_obra:  [{id:"dash",label:"Dashboard"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"}],
};

const EST_DEFAULT = [
  {no:1,monto:8500000,periodo:"01–31 Mar 2026",estatus:"Pagada"},
  {no:2,monto:7200000,periodo:"01–30 Abr 2026",estatus:"Facturada"},
  {no:3,monto:6100000,periodo:"01–20 May 2026",estatus:"En proceso"},
];

export default function App(){
  const[usuario,setUsuario]=useState(null);
  const[screen,setScreen]=useState("obras");
  const[obraId,setObraId]=useState(null);
  const[tab,setTab]=useState("dash");
  const[obras,setObras]=useState(()=>loadObras());
  const[subs,setSubs]=useState(SUBS_INIT);
  const[maquinaria,setMaquinaria]=useState([
    {id:1,desc:"Retroexcavadora CAT-416D",vol:2,und:"Mes",pu:70000,imp:140000},
    {id:2,desc:"Compactador BOMAG BW120", vol:2,und:"Mes",pu:35000,imp:70000},
    {id:3,desc:"",vol:"",und:"Mes",pu:"",imp:0},
    {id:4,desc:"",vol:"",und:"Mes",pu:"",imp:0},
    {id:5,desc:"",vol:"",und:"Mes",pu:"",imp:0},
  ]);
  const[materiales,setMateriales]=useState([
    {id:1,desc:"Tubería PEAD 18\"",      concepto:"En almacén",    vol:120,und:"ML", pu:2322.41,imp:278689},
    {id:2,desc:"Piso recinto negro 10×10cm",concepto:"En tránsito",  vol:850,und:"M2", pu:3652.58,imp:3104693},
    {id:3,desc:"Bolardos acero inoxidable",concepto:"En fabricación",vol:120,und:"PZA",pu:19562,  imp:2347440},
    {id:4,desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0},
    {id:5,desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0},
  ]);
  const[estimaciones,setEstimaciones]=useState(()=>{
    try{const s=localStorage.getItem("campo_estimaciones_OAX01");
      return s?JSON.parse(s):EST_DEFAULT;}catch{return EST_DEFAULT;}
  });

  if(!usuario) return <><style>{css}</style><Login onLogin={u=>{setUsuario(u);}}/></>;

  const obra=obras.find(o=>o.id===obraId);
  const setObra=u=>setObras(oo=>oo.map(o=>o.id===u.id?u:o));
  const entrar=id=>{setObraId(id);setScreen("obra");setTab("dash");};
  const volver=()=>{setScreen("obras");setObraId(null);};
  const logout=()=>{setUsuario(null);setScreen("obras");setObraId(null);};
  const TABS=TABS_POR_ROL[usuario.rol]||TABS_POR_ROL.director_operaciones;

  return <ErrorBoundary><>
    <style>{css}</style>
    {/* HEADER */}
    <div style={{background:C.bg,borderBottom:`1.5px solid ${C.caliza}`,padding:"10px 16px",
      display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
      position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <EmblemaFOSMON size={22}/>
        <div>
          <div style={{fontSize:15,fontWeight:800,letterSpacing:"0.14em",color:C.caliza,lineHeight:1}}>CAMPO</div>
          <div style={{fontSize:7,color:"rgba(255,254,249,0.4)",letterSpacing:"0.08em",marginTop:1}}>FOSMON CONSTRUCCIONES</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {screen==="obra"&&obra&&<span style={{fontSize:9,color:C.textMut,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{obra.contrato}</span>}
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:C.textSec}}>{usuario.nombre.split(" ")[0]}</div>
          <div style={{fontSize:8,color:C.textMut}}>{ROL_LABEL[usuario.rol]}</div>
        </div>
        <button onClick={logout} style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:6,
          padding:"4px 8px",fontSize:10,color:C.textMut,cursor:"pointer"}}>Salir</button>
      </div>
    </div>

    {screen==="obra"&&<button onClick={volver} style={{background:C.surface,border:"none",
      borderBottom:`0.5px solid ${C.border}`,padding:"8px 16px",fontSize:11,color:C.textSec,
      cursor:"pointer",textAlign:"left",width:"100%"}}>← Volver a obras</button>}

    {screen==="obra"&&<div className="noscroll" style={{background:C.bg,borderBottom:`0.5px solid ${C.border}`,
      display:"flex",overflowX:"auto",padding:"0 12px"}}>
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",
        borderBottom:`2px solid ${tab===t.id?C.caliza:"transparent"}`,padding:"9px 12px",fontSize:11,
        color:tab===t.id?C.caliza:"rgba(255,254,249,0.45)",cursor:"pointer",whiteSpace:"nowrap",
        fontWeight:tab===t.id?700:400,letterSpacing:"0.02em",transition:"all .15s"}}>{t.label}</button>)}
    </div>}

    <div style={{maxWidth:980,margin:"0 auto",padding:"14px 14px 56px"}}>
      {screen==="obras"&&<PantallaObras onSelect={entrar} usuario={usuario}/>}
      {screen==="obra"&&tab==="dash"&&obra&&<Dashboard obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} estimaciones={estimaciones}/>}
      {screen==="obra"&&tab==="captura"&&<Captura subs={subs} setSubs={setSubs} maquinaria={maquinaria} setMaquinaria={setMaquinaria} materiales={materiales} setMateriales={setMateriales} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="gastos"&&obra&&<GastosGP obra={obra} maquinaria={maquinaria} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="estimaciones"&&obra&&<Estimaciones obra={obra} setObra={setObra} estimaciones={estimaciones} setEstimaciones={setEstimaciones} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="riesgo"&&obra&&<Riesgo obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} estimaciones={estimaciones}/>}
    </div>

    {/* FOOTER */}
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.bg,
      borderTop:`0.5px solid ${C.border}`,padding:"6px 16px",
      display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:99}}>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <EmblemaFOSMON size={11} opacity={0.4}/>
        <span style={{fontSize:9,color:"rgba(255,254,249,0.22)",letterSpacing:"0.03em"}}>
          CAMPO — Control de Avance, Maquinaria, Personal y Obra
        </span>
      </div>
      <span style={{fontSize:9,color:"rgba(255,254,249,0.15)"}}>v1.0 · 2026</span>
    </div>
  </></ErrorBoundary>;
}
