#!/usr/bin/env python3
"""wpa_tool.py - utilitarios WPA/WPA2/WPA3 (802.11i/802.11w), Python puro.

Subcomandos:
  pmk       deriva o PMK (PSK) a partir da passphrase + SSID
  ptk       deriva o PTK (KCK/KEK/TK) a partir do PMK e dos nonces
  pmkid     deriva o PMKID (RSN/HMAC-SHA1 e SAE/SHA-256)
  strength  avalia forca/entropia de uma passphrase WPA
  audit     audita perfis WLAN exportados pelo netsh (XML)
  selftest  vetores de teste conhecidos (KAT) das derivacoes

Nao usa pacotes externos. Somente le: nao captura, nao injeta, nao quebra nada.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# --------------------------------------------------------------------------
# Constantes / helpers
# --------------------------------------------------------------------------

PMK_LEN = 32
PBKDF2_ITERS = 4096
PRF_ROUNDS = 4096

# IEEE 802.11-2016 (RSN, AKM PSK): PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096, 32)
PMK_KAT = {
    ("password", "IEEE"): "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e",
}

WLAN_NS = "http://www.microsoft.com/networking/WLAN/profile/v1"


def _strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(node, name):
    """Busca o primeiro elemento (ignorando namespace) pelo nome local."""
    for el in node.iter():
        if _strip_ns(el.tag) == name:
            return el
    return None


def _findall(node, name):
    return [el for el in node.iter() if _strip_ns(el.tag) == name]


def _text(node, name, default=""):
    el = _find(node, name)
    if el is None or el.text is None:
        return default
    return el.text.strip()


def _mac(value: str) -> bytes:
    """Converte 'aa:bb:cc:dd:ee:ff' em 6 bytes."""
    cleaned = re.sub(r"[^0-9a-fA-F]", "", value)
    if len(cleaned) != 12:
        raise ValueError(f"MAC invalido: {value!r}")
    return bytes.fromhex(cleaned)


def _hexs(value: str) -> bytes:
    cleaned = re.sub(r"[^0-9a-fA-F]", "", value)
    if len(cleaned) % 2:
        raise ValueError(f"hex invalido: {value!r}")
    return bytes.fromhex(cleaned)


def _fmt(data: bytes) -> str:
    return data.hex()


# --------------------------------------------------------------------------
# Derivacoes de chave
# --------------------------------------------------------------------------


def derive_pmk(passphrase: str, ssid: str) -> bytes:
    """PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096, 32)."""
    if isinstance(passphrase, str):
        passphrase = passphrase.encode("utf-8")
    if isinstance(ssid, str):
        ssid = ssid.encode("utf-8")
    return hashlib.pbkdf2_hmac("sha1", passphrase, ssid, PBKDF2_ITERS, PMK_LEN)


def _prf_sha1(key: bytes, label: bytes, seed: bytes, out_len: int) -> bytes:
    """PRF-512/128 de 802.11 (HMAC-SHA1, contador BE de 4 bytes, 4096 rodadas).

    Equivale a wpa_prf_sha1_derive_key() do wpa_supplicant.
    """
    out = bytearray()
    base = label + seed
    for i in range(PRF_ROUNDS):
        if len(out) >= out_len:
            break
        counter = i.to_bytes(4, "big")
        out += hmac.new(key, counter + base, hashlib.sha1).digest()
    return bytes(out[:out_len])


def derive_ptk(pmk: bytes, aa: bytes, sa: bytes, anonce: bytes, snonce: bytes,
               sha256_akm: bool = False) -> dict:
    """PTK = PRF(PMK, "Pairwise key expansion", Min/Max(AA,SA) || Min/Max(ANonce,SNonce)).

    AKM SHA-256 (802.11-2016+): PRF-256/HMAC-SHA256, KCK/KEK/TK de 32 bytes.
    AKM SHA-1: PRF-512/HMAC-SHA1, KCK/KEK/TK de 16 bytes.
    """
    if sha256_akm:
        prf = lambda k, l, s, n: _prf_sha256(k, l, s, n)
        klen = 32
    else:
        prf = _prf_sha1
        klen = 16

    lo_addr, hi_addr = sorted([aa, sa])
    lo_nonce, hi_nonce = sorted([anonce, snonce])
    seed = lo_addr + hi_addr + lo_nonce + hi_nonce
    ptk = prf(pmk, b"Pairwise key expansion", seed, klen * 3)

    return {
        "akm": "sha256" if sha256_akm else "sha1",
        "ptk": ptk,
        "kck": ptk[0:klen],
        "kek": ptk[klen:2 * klen],
        "tk": ptk[2 * klen:3 * klen],
    }


def _prf_sha256(key: bytes, label: bytes, seed: bytes, out_len: int) -> bytes:
    out = bytearray()
    base = label + seed
    for i in range(PRF_ROUNDS):
        if len(out) >= out_len:
            break
        counter = i.to_bytes(4, "big")
        out += hmac.new(key, counter + base, hashlib.sha256).digest()
    return bytes(out[:out_len])


def derive_pmkid(pmk: bytes, aa: bytes, spa: bytes, anonce: bytes,
                 sae: bool = False) -> bytes:
    """PMKID de pre-autenticacao oportunista (16 bytes).

    RSN (WPA2): Truncate-128(HMAC-SHA1-128(PMK, "PMK Name" || AA || SPA || NA || SPA))
    SAE (WPA3): Truncate-128(SHA-256("PMK Name" || AA || SPA || NA || SPA))
    """
    label = b"PMK Name"
    data = label + aa + spa + anonce + spa
    if sae:
        digest = hashlib.sha256(data).digest()
    else:
        digest = hmac.new(pmk, data, hashlib.sha1).digest()
    return digest[:16]


# --------------------------------------------------------------------------
# Avaliacao de passphrase
# --------------------------------------------------------------------------

COMMON_PASSWORDS = {
    "password", "123456", "12345678", "123456789", "qwerty", "abc123",
    "password1", "admin", "welcome", "iloveyou", "monkey", "dragon",
    "letmein", "sunshine", "princess", "football", "default", "senha",
    "senha123", "mudar123", "1234567890", "qwerty123", "111111",
}

KEYBOARD_ROWS = [
    "qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "qazwsxedc",
    "qwertyuiopasdfghjklzxcvbnm", "abcdefghijklmnopqrstuvwxyz",
]


def _runs(seq: str) -> int:
    """Numero de sequencias crescentes/decrescentes de 3+ caracteres."""
    total = 0
    for row in KEYBOARD_ROWS:
        for i in range(len(row) - 2):
            for piece in (row[i:i + 3], row[::-1][i:i + 3]):
                total += seq.count(piece)
    for i in range(len(seq) - 2):
        chunk = seq[i:i + 3]
        if chunk.isdigit() and int(chunk[1]) == (int(chunk[0]) + 1) % 10:
            total += 1
    return total


def passphrase_strength(passphrase: str, ssid: str = "") -> dict:
    """Estima entropia e penaliza padroes fracos conhecidos."""
    if not passphrase:
        return {
            "score": 0, "bits": 0.0, "length": 0, "charset": 0,
            "findings": ["passphrase vazia"],
        }

    lowered = passphrase.lower()
    charset = 0
    if any(c.islower() for c in passphrase):
        charset += 26
    if any(c.isupper() for c in passphrase):
        charset += 26
    if any(c.isdigit() for c in passphrase):
        charset += 10
    if any(not c.isalnum() for c in passphrase):
        charset += 33

    bits = len(passphrase) * (math.log2(charset) if charset else 0)

    findings = []
    penalty = 0.0

    if len(passphrase) < 8:
        findings.append(f"curta demais ({len(passphrase)} caracteres, minimo recomendado 12)")
        penalty += 25
    elif len(passphrase) < 12:
        findings.append(f"curta demais ({len(passphrase)} caracteres, minimo recomendado 12)")
        penalty += 10

    if lowered in COMMON_PASSWORDS:
        findings.append("presente em lista de senhas comuns")
        penalty += 45
    elif any(w in lowered for w in COMMON_PASSWORDS):
        findings.append("contem um termo de senha comum")
        penalty += 20

    if ssid and lowered in (ssid.lower(), ssid.lower() + "123", ssid.lower() + "!"):
        findings.append("igual (ou derivada trivial) do SSID")
        penalty += 40

    if passphrase.isdigit():
        findings.append("somente digitos")
        penalty += 30
    if passphrase.isalpha() and passphrase.islower():
        findings.append("somente minusculas")
        penalty += 15
    if passphrase.isalpha() and passphrase.isupper():
        findings.append("somente maiusculas")
        penalty += 20

    counts = Counter(passphrase)
    if counts and max(counts.values()) / len(passphrase) > 0.5:
        findings.append("caractere unico repetido")
        penalty += 20

    run_count = _runs(lowered)
    if run_count:
        findings.append("contem sequencias de teclado ou numeros")
        penalty += min(25, run_count * 5)

    if len(set(passphrase)) < len(passphrase) * 0.4:
        findings.append("pouca variacao de caracteres")
        penalty += 15

    bits = max(0.0, bits - penalty)
    score = int(max(0, min(100, round(bits))))

    if score >= 80:
        label = "forte"
    elif score >= 60:
        label = "aceitavel"
    elif score >= 40:
        label = "fraca"
    else:
        label = "muito fraca"

    return {
        "score": score,
        "label": label,
        "bits": round(bits, 1),
        "length": len(passphrase),
        "charset": charset,
        "findings": findings or ["nenhum padrao fraco conhecido"],
    }


def mask(passphrase: str) -> str:
    """Mascara a passphrase para exibicao em relatorios."""
    if not passphrase:
        return "(vazia)"
    if len(passphrase) <= 4:
        return "*" * len(passphrase)
    return passphrase[:2] + "*" * (len(passphrase) - 4) + passphrase[-2:]


# --------------------------------------------------------------------------
# Auditoria de perfis WLAN
# --------------------------------------------------------------------------

SEV_ORDER = {"Critico": 0, "Alto": 1, "Medio": 2, "Baixo": 3, "Informativo": 4}


def _finding(sev, target, title, evidence, fix):
    return {"severity": sev, "target": target, "finding": title,
            "evidence": evidence, "fix": fix}


def audit_profile(path: Path) -> dict:
    """Audita um XML de perfil WLAN exportado pelo netsh."""
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        return {"profile": path.name, "error": f"XML invalido: {exc}", "findings": []}
    root = tree.getroot()

    name = _text(root, "name", path.stem)
    ssid = _text(root, "name") or name
    hex_ssid = _text(root, "hex")

    auth = _text(root, "authentication")
    enc = _text(root, "encryption")
    use_one_x = _text(root, "useOneX").lower() == "true"
    transition = _text(root, "transitionMode").lower() == "true"

    shared = _find(root, "sharedKey")
    key_material = _text(shared, "keyMaterial") if shared is not None else ""
    key_type = _text(shared, "keyType") if shared is not None else ""
    key_protected = _text(shared, "protected").lower() == "true" if shared is not None else False

    mac_rand = _text(root, "enableRandomization").lower() == "true"

    # OneX / EAP
    eap_outer = ""
    eap_inner = ""
    server_validation_disabled = False
    perform_server_validation = True
    accept_server_name = True
    allow_prompt_no_ca = False
    trusted_ca = False
    crypto_binding = False
    onex = _find(root, "OneX")
    if onex is not None:
        methods = _findall(onex, "EapMethod")
        if methods:
            eap_outer = _text(methods[0], "Type")
        # O EAP interno e o <Eap> aninhado dentro de outro <Eap>.
        outer_eap = _find(onex, "Eap")
        if outer_eap is not None:
            for el in outer_eap.iter():
                if _strip_ns(el.tag) == "Eap" and el is not outer_eap:
                    eap_inner = _text(el, "Type")
                    break
        server_validation_disabled = (
            _text(onex, "DisableUserPromptForServerValidation").lower() == "true")
        perform_server_validation = (
            _text(onex, "PerformServerValidation").lower() != "false")
        accept_server_name = _text(onex, "AcceptServerName").lower() != "false"
        allow_prompt_no_ca = (
            _text(onex, "AllowPromptingWhenServerCANotFound").lower() == "true")
        trusted_ca = bool(_findall(onex, "TrustedRootCA"))
        crypto_binding = _text(onex, "RequireCryptoBinding").lower() == "true"

    findings = []
    auth_upper = (auth or "").upper()
    enc_upper = (enc or "").upper()

    if auth_upper in ("", "OPEN", "NONE"):
        findings.append(_finding(
            "Critico", ssid, "Rede aberta (sem autenticacao)",
            f"authentication='{auth}' encryption='{enc}'",
            "Ative WPA3-SAE ou WPA2-Personal com AES"))
    if enc_upper in ("WEP", "NONE", "") and auth_upper not in ("", "OPEN", "NONE"):
        findings.append(_finding(
            "Critico", ssid, "Cifra WEP ou ausente",
            f"encryption='{enc}'",
            "Migrate para CCMP (AES) ou GCMP"))

    if auth_upper == "WPA" or enc_upper == "TKIP":
        findings.append(_finding(
            "Alto", ssid, "WPA1/TKIP obsoleto",
            f"authentication='{auth}' encryption='{enc}'",
            "Migrate para WPA2-Personal (CCMP) ou WPA3-SAE (GCMP)"))

    if "WPA3" in auth_upper and "ENTERPRISE" in auth_upper:
        findings.append(_finding(
            "Baixo", ssid, "WPA3-Enterprise configurado",
            f"authentication='{auth}'", "Nenhuma acao required"))

    if transition:
        findings.append(_finding(
            "Medio", ssid, "WPA3 em transition mode (risco de downgrade)",
            "transitionMode=true",
            "Desative a transition mode apos migrar todos os clientes para WPA3"))

    if key_material:
        strength = passphrase_strength(key_material, ssid)
        if strength["score"] < 40:
            findings.append(_finding(
                "Alto", ssid, f"PSK muito fraca ({strength['label']})",
                f"forca={strength['score']}/100, {strength['length']} chars, "
                f"achados={'; '.join(strength['findings'])}",
                "Use passphrase com no minimo 16 caracteres e alta entropia"))
        elif strength["score"] < 60:
            findings.append(_finding(
                "Medio", ssid, f"PSK fraca ({strength['label']})",
                f"forca={strength['score']}/100, {strength['length']} chars, "
                f"achados={'; '.join(strength['findings'])}",
                "Aumente comprimento e variacao de caracteres"))
        if not key_protected:
            findings.append(_finding(
                "Informativo", ssid, "Chave armazenada em texto claro no perfil",
                "sharedKey/protected=false",
                "Exportar com key=clear apenas em ambiente confiavel"))

    if use_one_x or "ENTERPRISE" in auth_upper:
        if eap_outer == "25":  # PEAP
            if eap_inner == "26":  # EAP-MSCHAPv2
                findings.append(_finding(
                    "Medio", ssid, "Enterprise com EAP-MSCHAPv2 (quebra offline possivel)",
                    "EapMethod outer=25 (PEAP) inner=26 (EAP-MSCHAPv2)",
                    "Prefira EAP-TLS (21) com validacao de certificado"))
            else:
                findings.append(_finding(
                    "Informativo", ssid, "Enterprise com PEAP",
                    f"EapMethod outer=25 (PEAP) inner={eap_inner or 'desconhecido'}",
                    "Avaliar migracao para EAP-TLS"))
        elif eap_outer == "21":  # EAP-TLS
            findings.append(_finding(
                "Informativo", ssid, "Enterprise com EAP-TLS",
                "EapMethod outer=21 (EAP-TLS)",
                "Nenhuma acao required"))
        elif eap_outer:
            findings.append(_finding(
                "Informativo", ssid, f"Enterprise com EAP tipo {eap_outer}",
                f"EapMethod outer={eap_outer}",
                "Confirmar o metodo EAP no seu desenho de seguranca"))
        if server_validation_disabled:
            findings.append(_finding(
                "Alto", ssid, "Validacao de servidor desabilitada (possivel MITM)",
                "DisableUserPromptForServerValidation=true",
                "Habilite a validacao do certificado do servidor RADIUS"))
        if not perform_server_validation:
            findings.append(_finding(
                "Alto", ssid, "Validacao do servidor RADIUS nao executada",
                "PerformServerValidation=false",
                "Habilite PerformServerValidation e cadastre a CA confiavel"))
        if not accept_server_name:
            findings.append(_finding(
                "Medio", ssid, "Nome do servidor RADIUS nao verificado",
                "AcceptServerName=false",
                "Restrinja o PEAP ao nome do servidor RADIUS da organizacao"))
        if allow_prompt_no_ca:
            findings.append(_finding(
                "Medio", ssid, "Aceita servidor sem CA conhecida",
                "AllowPromptingWhenServerCANotFound=true",
                "Exija a CA confianca da organizacao"))
        if not trusted_ca:
            findings.append(_finding(
                "Alto", ssid, "Nenhuma CA raiz confiavel configurada",
                "TrustedRootCA ausente",
                "Cadastre a CA do servidor RADIUS"))
        if not crypto_binding and eap_outer == "25":
            findings.append(_finding(
                "Baixo", ssid, "Crypto binding nao exigido",
                "RequireCryptoBinding=false",
                "Exija RequireCryptoBinding para vincular canal ao TLS"))

    if not mac_rand:
        findings.append(_finding(
            "Baixo", ssid, "MAC randomization desabilitada",
            "MacRandomization/enableRandomization=false",
            "Habilite a randomizacao de MAC nos perfis moveis"))

    if use_one_x and "ENTERPRISE" not in auth_upper:
        findings.append(_finding(
            "Informativo", ssid, "Perfil OneX marcado para uso de 802.1X",
            f"useOneX=true, authentication={auth}",
            "Verificar coerencia do perfil"))

    return {
        "profile": path.name,
        "ssid": ssid,
        "ssid_hex": hex_ssid,
        "authentication": auth,
        "encryption": enc,
        "enterprise": use_one_x or "ENTERPRISE" in auth_upper,
        "transition_mode": transition,
        "eap_outer": eap_outer,
        "eap_inner": eap_inner,
        "mac_randomization": mac_rand,
        "psk_masked": mask(key_material) if key_material else "",
        "psk_strength": passphrase_strength(key_material, ssid) if key_material else None,
        "findings": findings,
    }


def audit_directory(directory: Path) -> list:
    results = []
    for xml in sorted(directory.glob("*.xml")):
        results.append(audit_profile(xml))
    return results


def export_profiles(directory: Path) -> None:
    """Chama netsh para exportar todos os perfis (com chave em claro)."""
    subprocess.run(
        ["netsh", "wlan", "export", "profile", f"folder={directory}", "key=clear"],
        capture_output=True, text=True, check=False)


# --------------------------------------------------------------------------
# Inventario via netsh
# --------------------------------------------------------------------------

def _oem_codepage() -> str | None:
    """Codepage OEM do console (ex.: cp850 em pt-BR, cp437 em en-US)."""
    try:
        import ctypes
        return f"cp{ctypes.windll.kernel32.GetOEMCP()}"
    except Exception:
        return None


def _netsh(*args: str) -> str:
    """Executa netsh e devolve a saida decodificada.

    O netsh do Windows escreve na codepage OEM do console (cp850/437), nao em
    UTF-8 nem na ANSI. Descobre a codepage via GetOEMCP() antes de decodificar.
    """
    try:
        proc = subprocess.run(["netsh", "wlan", *args], capture_output=True,
                              check=False)
    except FileNotFoundError:
        return ""
    raw = proc.stdout or b""

    candidates = []
    oem = _oem_codepage()
    if oem:
        candidates.append(oem)
    candidates += ["cp850", "cp437", "cp1252", "latin-1"]

    for enc in candidates:
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def _norm(text: str) -> str:
    """Normaliza um rotulo para comparacao: sem acento, minusculo, so alfanumerico."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def _netsh_value(text: str, label: str) -> str:
    """Extrai o valor de uma linha 'Label : value' do netsh (acentos ignorados)."""
    target = _norm(label)
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        if _norm(key) == target:
            return value.strip()
    return ""


def inventory() -> dict:
    """Monta o inventario de interfaces, drivers e redes visiveis."""
    interfaces_raw = _netsh("show", "interfaces")
    drivers_raw = _netsh("show", "drivers")
    networks_raw = _netsh("show", "networks", "mode=bssid")

    # Cada interface comeca numa linha "Nome ... : <nome>".
    blocks = []
    current: list[str] = []
    for line in interfaces_raw.splitlines():
        if re.match(r"^\s*Nome\s+:", line) and current:
            blocks.append("\n".join(current))
            current = []
        if current or re.match(r"^\s*Nome\s+:", line):
            current.append(line)
    if current:
        blocks.append("\n".join(current))

    interfaces = []
    for block in blocks:
        if "Nome" not in block:
            continue
        interfaces.append({
            "name": _netsh_value(block, "Nome"),
            "description": _netsh_value(block, "Descricao"),
            "bssid": _netsh_value(block, "Endereco fisico"),
            "type": _netsh_value(block, "Tipo de interface"),
            "state": _netsh_value(block, "Estado"),
            "ssid": _netsh_value(block, "SSID"),
            "radio_type": _netsh_value(block, "Tipo de radio"),
            "authentication": _netsh_value(block, "Autenticacao"),
            "encryption": _netsh_value(block, "Criptografia"),
            "band": _netsh_value(block, "Faixa"),
            "channel": _netsh_value(block, "Canal"),
            "link_rx_mbps": _netsh_value(block, "Taxa de recepcao (Mbps)"),
        })

    radio_types = sorted(set(re.findall(r"802\.11[a-z0-9]+", drivers_raw)))
    driver = {
        "radio_types": [r for r in radio_types if r != "802.11w"],
        "supports_80211w": "802.11w" in drivers_raw.lower(),
        "fips": _netsh_value(drivers_raw, "Suporte para o modo FIPS 140-2").lower() == "sim",
    }

    networks = []
    current_ssid = ""
    current_bssid = {}

    def split_kv(line: str):
        """Divide 'rotulo : valor' -> (rotulo normalizado, valor bruto)."""
        if ":" not in line:
            return None, None
        key, _, value = line.partition(":")
        return _norm(key), value.strip()

    for line in networks_raw.splitlines():
        stripped = line.strip()
        key, value = split_kv(stripped)
        if key is None:
            continue

        m_ssid = re.match(r"^ssid\s+(\d+)$", key)
        m_bssid = re.match(r"^bssid\s+(\d+)$", key)
        if m_ssid:
            if current_bssid:
                networks.append(current_bssid)
                current_bssid = {}
            current_ssid = value
            continue
        if m_bssid:
            if current_bssid:
                networks.append(current_bssid)
            current_bssid = {
                "ssid": current_ssid,
                "bssid": value.lower(),
                "signal": "",
                "band": "",
                "channel": "",
                "radio_type": "",
                "stations": "",
            }
            continue
        if current_bssid:
            if key.startswith("sinal"):
                current_bssid["signal"] = value
            elif key.startswith("banda"):
                current_bssid["band"] = value
            elif key.startswith("canal"):
                current_bssid["channel"] = value
            elif key.startswith("tipo de radio"):
                current_bssid["radio_type"] = value
            elif "estacoes conectadas" in key:
                current_bssid["stations"] = value
    if current_bssid:
        networks.append(current_bssid)

    profiles = []
    for line in _netsh("show", "profiles").splitlines():
        m = re.search(r"Perfis de Usu.rios:\s*(.+)$", line)
        if m:
            profiles.append(m.group(1).strip())

    return {
        "interfaces": interfaces,
        "driver": driver,
        "networks": networks,
        "saved_profiles": profiles,
    }


def print_inventory(data: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    print("== Interfaces ==")
    for i in data["interfaces"]:
        print(f"  {i['name']} ({i['description']})")
        print(f"    estado={i['state']}  bssid={i['bssid']}  ssid={i['ssid']}")
        print(f"    radio={i['radio_type']}  autenticacao={i['authentication']}  "
              f"criptografia={i['encryption']}  banda={i['band']}  canal={i['channel']}")
        print(f"    rx={i['link_rx_mbps']} Mbps")

    d = data["driver"]
    print("\n== Driver ==")
    print(f"  tipos de radio   : {', '.join(d['radio_types']) or '(nao lido)'}")
    print(f"  suporte 802.11w  : {d['supports_80211w']}")
    print(f"  FIPS 140-2       : {d['fips']}")

    print("\n== Redes visiveis ==")
    for n in data["networks"]:
        print(f"  {n['ssid']}  bssid={n['bssid']}  sinal={n['signal']}  "
              f"banda={n['band']}  canal={n['channel']}  radio={n['radio_type']}  "
              f"stations={n['stations']}")

    print("\n== Perfis salvos ==")
    for p in data["saved_profiles"]:
        print(f"  {p}")


# --------------------------------------------------------------------------
# Relatorios
# --------------------------------------------------------------------------

def print_audit(results: list, as_json: bool) -> None:
    if as_json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
        return

    if not results:
        print("Nenhum perfil encontrado.")
        return

    total = Counter()
    for res in results:
        if res.get("error"):
            print(f"[erro] {res['profile']}: {res['error']}")
            continue
        print(f"\n=== {res['ssid']}  ({res['profile']}) ===")
        print(f"  autenticacao : {res['authentication']}  "
              f"cifra: {res['encryption']}  "
              f"enterprise: {res['enterprise']}  "
              f"transition: {res['transition_mode']}")
        if res["eap_outer"]:
            print(f"  EAP          : outer={res['eap_outer']} inner={res['eap_inner'] or '-'}")
        if res["psk_masked"]:
            print(f"  PSK          : {res['psk_masked']}  "
                  f"forca={res['psk_strength']['score']}/100 ({res['psk_strength']['label']})")
        print(f"  MAC rand.    : {res['mac_randomization']}")
        if not res["findings"]:
            print("  sem achados")
        for f in sorted(res["findings"], key=lambda x: SEV_ORDER.get(x["severity"], 9)):
            total[f["severity"]] += 1
            print(f"  [{f['severity']}] {f['finding']}")
            print(f"      evidencia: {f['evidence']}")
            print(f"      correcao : {f['fix']}")

    print("\n--- Totais ---")
    for sev in ("Critico", "Alto", "Medio", "Baixo", "Informativo"):
        if total.get(sev):
            print(f"  {sev}: {total[sev]}")
    if not total:
        print("  nenhum achado")


# --------------------------------------------------------------------------
# Selftest
# --------------------------------------------------------------------------

def selftest() -> int:
    failures = []

    for (pw, ssid), expected in PMK_KAT.items():
        got = _fmt(derive_pmk(pw, ssid))
        status = "ok" if got == expected else "FALHOU"
        print(f"PMK  SSID={ssid!r:8} -> {got}  [{status}]")
        if got != expected:
            failures.append(f"PMK({pw!r},{ssid!r}) = {got} != {expected}")

    # PTK determinismo + separacao de Dominios (nao e KAT publicado, e invariante)
    pmk = derive_pmk("password", "IEEE")
    aa = _mac("00:0f:b3:8a:5c:1e")
    sa = _mac("00:13:10:d4:9a:6b")
    anonce = bytes.fromhex("3d1581d1dd3e5f6b0e6cbd1e0f7a3b5c")
    snonce = bytes.fromhex("9b1c3f5a7d2e4f6081a2b3c4d5e6f708")
    p1 = derive_ptk(pmk, aa, sa, anonce, snonce)
    p2 = derive_ptk(pmk, aa, sa, anonce, snonce)
    ok = p1["ptk"] == p2["ptk"] and len(p1["kck"]) == 16
    print(f"PTK  determinismo + tamanhos (16/16/16)  [{'ok' if ok else 'FALHOU'}]")
    if not ok:
        failures.append("PTK nao deterministico ou tamanhos invalidos")

    swapped = derive_ptk(pmk, sa, aa, snonce, anonce)
    ok = swapped["ptk"] == p1["ptk"]
    print(f"PTK  invariante a ordem AA/SA e ANonce/SNonce  [{'ok' if ok else 'FALHOU'}]")
    if not ok:
        failures.append("PTK nao invariante a ordenacao")

    # PRF vs. implementacao de referencia independente (mesmo algoritmo, escrita diferente)
    ref = bytearray()
    for i in range(4096):
        ref += hmac.new(pmk, i.to_bytes(4, "big") + b"Pairwise key expansion" + aa + sa + anonce + snonce,
                        hashlib.sha1).digest()
    ok = bytes(ref[:48]) == p1["ptk"]
    print(f"PTK  bate com PRF de referencia (Min/Max fixo)  [{'ok' if ok else 'FALHOU'}]")
    if not ok:
        failures.append("PTK diverge da PRF de referencia")

    # PMKID: RSN vs SAE devem diferir; tamanho 16
    pmkid_rsn = derive_pmkid(pmk, aa, sa, anonce, sae=False)
    pmkid_sae = derive_pmkid(pmk, aa, sa, anonce, sae=True)
    ok = len(pmkid_rsn) == 16 and len(pmkid_sae) == 16 and pmkid_rsn != pmkid_sae
    print(f"PMKID RSN={_fmt(pmkid_rsn)} SAE={_fmt(pmkid_sae)}  [{'ok' if ok else 'FALHOU'}]")
    if not ok:
        failures.append("PMKID invalido")

    # strength: casos conhecidos
    cases = [
        ("password", "", False),
        ("12345678", "", False),
        ("Xk9#mQ2vLp7$Rt4Z", "", True),
    ]
    for pw, ssid, should_be_strong in cases:
        st = passphrase_strength(pw, ssid)
        ok = (st["score"] >= 60) == should_be_strong
        print(f"STR  {pw[:14]:14} score={st['score']:3} ({st['label']})  [{'ok' if ok else 'FALHOU'}]")
        if not ok:
            failures.append(f"strength({pw!r}) inesperado: {st['score']}")

    print()
    if failures:
        print("FALHAS:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Todos os testes passaram.")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="wpa_tool.py",
        description="Utilitarios WPA/WPA2/WPA3 (somente leitura, sem dependencias).")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pmk = sub.add_parser("pmk", help="deriva o PMK (PSK) a partir da passphrase e do SSID")
    p_pmk.add_argument("--ssid", required=True)
    p_pmk.add_argument("--passphrase", required=True)

    p_ptk = sub.add_parser("ptk", help="deriva o PTK (KCK/KEK/TK)")
    p_ptk.add_argument("--pmk", help="PMK em hex (ou use --ssid/--passphrase)")
    p_ptk.add_argument("--ssid")
    p_ptk.add_argument("--passphrase")
    p_ptk.add_argument("--aa", required=True, help="endereco do AP (AA)")
    p_ptk.add_argument("--sa", required=True, help="endereco do STA (SA)")
    p_ptk.add_argument("--anonce", required=True, help="nonce do AP em hex")
    p_ptk.add_argument("--snonce", required=True, help="nonce do STA em hex")
    p_ptk.add_argument("--sha256-akm", action="store_true")

    p_pmkid = sub.add_parser("pmkid", help="deriva o PMKID (RSN ou SAE)")
    p_pmkid.add_argument("--pmk", help="PMK em hex (ou use --ssid/--passphrase)")
    p_pmkid.add_argument("--ssid")
    p_pmkid.add_argument("--passphrase")
    p_pmkid.add_argument("--aa", required=True)
    p_pmkid.add_argument("--spa", required=True, help="endereco do STA")
    p_pmkid.add_argument("--anonce", required=True)
    p_pmkid.add_argument("--sae", action="store_true", help="usa a variante WPA3/SAE")

    p_strength = sub.add_parser("strength", help="avalia a forca de uma passphrase")
    p_strength.add_argument("--passphrase", required=True)
    p_strength.add_argument("--ssid", default="")
    p_strength.add_argument("--json", action="store_true")

    p_audit = sub.add_parser("audit", help="audita perfis WLAN exportados pelo netsh")
    p_audit.add_argument("--profiles", help="diretorio com XMLs exportados pelo netsh")
    p_audit.add_argument("--netsh", action="store_true",
                         help="exporta os perfis do sistema antes de auditar")
    p_audit.add_argument("--json", action="store_true")

    p_inv = sub.add_parser("inventory", help="inventario de interfaces, redes e perfis via netsh")
    p_inv.add_argument("--json", action="store_true")

    sub.add_parser("selftest", help="executa os vetores de teste conhecidos")

    args = parser.parse_args(argv)

    if args.cmd == "pmk":
        print(_fmt(derive_pmk(args.passphrase, args.ssid)))
        return 0

    if args.cmd in ("ptk", "pmkid"):
        if args.pmk:
            pmk = _hexs(args.pmk)
        elif args.ssid and args.passphrase:
            pmk = derive_pmk(args.passphrase, args.ssid)
        else:
            print("informe --pmk ou --ssid/--passphrase", file=sys.stderr)
            return 2
        if len(pmk) != PMK_LEN:
            print(f"PMK deve ter {PMK_LEN} bytes", file=sys.stderr)
            return 2

        if args.cmd == "ptk":
            out = derive_ptk(pmk, _mac(args.aa), _mac(args.sa),
                             _hexs(args.anonce), _hexs(args.snonce),
                             sha256_akm=args.sha256_akm)
            print(f"AKM    : {out['akm']}")
            print(f"PTK    : {_fmt(out['ptk'])}")
            print(f"KCK    : {_fmt(out['kck'])}")
            print(f"KEK    : {_fmt(out['kek'])}")
            print(f"TK     : {_fmt(out['tk'])}")
        else:
            pmkid = derive_pmkid(pmk, _mac(args.aa), _mac(args.spa),
                                 _hexs(args.anonce), sae=args.sae)
            print(f"PMKID ({'SAE' if args.sae else 'RSN'}): {_fmt(pmkid)}")
        return 0

    if args.cmd == "strength":
        result = passphrase_strength(args.passphrase, args.ssid)
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"score : {result['score']}/100 ({result['label']})")
            print(f"bits  : {result['bits']} estimados")
            print(f"chars : {result['length']}  (charset {result['charset']})")
            for f in result["findings"]:
                print(f"  - {f}")
        return 0

    if args.cmd == "audit":
        tmp = None
        try:
            if args.netsh:
                tmp = Path(tempfile.mkdtemp(prefix="wpa-audit-"))
                export_profiles(tmp)
                directory = tmp
            else:
                if not args.profiles:
                    print("informe --profiles <dir> ou --netsh", file=sys.stderr)
                    return 2
                directory = Path(args.profiles)

            if not directory.is_dir():
                print(f"diretorio inexistente: {directory}", file=sys.stderr)
                return 2

            results = audit_directory(directory)
            print_audit(results, args.json)
            return 0
        finally:
            if tmp and tmp.exists():
                for f in tmp.glob("*.xml"):
                    try:
                        f.unlink()
                    except OSError:
                        pass
                try:
                    tmp.rmdir()
                except OSError:
                    pass

    if args.cmd == "inventory":
        print_inventory(inventory(), args.json)
        return 0

    if args.cmd == "selftest":
        return selftest()

    return 0


if __name__ == "__main__":
    sys.exit(main())
