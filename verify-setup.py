#!/usr/bin/env python3
"""
Script de verificación para VICENTURBO_AI
Verifica que todas las dependencias estén instaladas correctamente
"""

import sys
import os

def check_python():
    """Verificar versión de Python"""
    print(f"[OK] Python {sys.version}")
    return True

def check_modules():
    """Verificar módulos requeridos"""
    required_modules = ['websockets', 'tkinter', 'threading', 'json', 'asyncio']
    
    missing_modules = []
    for module in required_modules:
        try:
            __import__(module)
            print(f"[OK] {module}")
        except ImportError:
            print(f"[MISSING] {module} - FALTA")
            missing_modules.append(module)
    
    return len(missing_modules) == 0

def check_irsdk():
    """Verificar irsdk"""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'pyirsdk_Reference'))
        import irsdk
        print("[OK] irsdk")
        return True
    except ImportError:
        print("[MISSING] irsdk - FALTA")
        return False

def main():
    print("=== VERIFICACIÓN DE VICENTURBO_AI ===\n")
    
    python_ok = check_python()
    modules_ok = check_modules()
    irsdk_ok = check_irsdk()
    
    print(f"\n=== RESULTADO ===")
    if python_ok and modules_ok and irsdk_ok:
        print("OK: ¡Todo está configurado correctamente!")
        print("\nPuedes ejecutar el proyecto con:")
        print("npm run dev:iracing")
        sys.exit(0)
    else:
        print("ERROR: Hay problemas de configuración")
        print("Ejecuta: setup-python.bat")
        sys.exit(1)

if __name__ == "__main__":
    main()
