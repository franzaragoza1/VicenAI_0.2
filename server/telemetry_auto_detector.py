#!/usr/bin/env python3
"""
Telemetry Auto-Detector for iRacing and Le Mans Ultimate

This module automatically detects which racing simulator is running and launches
the appropriate telemetry service. It monitors for process presence and SDK/shared
memory connectivity to determine which simulator is active.

Features:
- Automatic detection of iRacing (via process and pyirsdk)
- Automatic detection of LMU (via process and shared memory)
- Priority-based service launching (iRacing takes precedence if both detected)
- Automatic service monitoring and restart on disconnect
- Graceful shutdown handling

Usage:
    python telemetry_auto_detector.py
"""

import sys
import os
import time
import subprocess
import logging
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Try to import psutil with fallback warning
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logger.warning("⚠️  psutil not available - process detection will be limited")

# Constants
DETECTION_INTERVAL = 5.0  # seconds between detection attempts
RECONNECT_DELAY = 10.0    # seconds to wait before reconnecting after disconnect


def detect_iracing() -> bool:
    """
    Detect if iRacing is currently running.
    
    Priority order:
    1. SDK connection test (most reliable - only works if sim is actually running)
    2. Process detection (only checks for main sim executable, not service)
    
    Returns:
        bool: True if iRacing is detected, False otherwise
    """
    # Method 1 (PRIORITY): Try pyirsdk connection - most reliable
    try:
        # Import from pyirsdk_Reference
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pyirsdk_Reference'))
        import irsdk
        
        ir = irsdk.IRSDK()
        if ir.startup():
            ir.shutdown()
            logger.info("✅ iRacing detected (SDK connection)")
            return True
    except Exception as e:
        logger.debug(f"iRacing SDK check failed: {e}")
    
    # Method 2: Check for main iRacing sim process (not service)
    # Only check for actual simulator executable, ignore background services
    if PSUTIL_AVAILABLE:
        try:
            # ONLY the main simulator executables - not services!
            iracing_sim_processes = [
                'iRacingSim64DX11.exe',  # Main DX11 simulator
                'iRacingSim.exe',        # Legacy simulator
            ]
            
            for proc in psutil.process_iter(['name']):
                try:
                    proc_name = proc.info['name']
                    if proc_name in iracing_sim_processes:
                        logger.info("✅ iRacing detected (sim process)")
                        return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception as e:
            logger.debug(f"Error checking iRacing processes: {e}")
    
    return False


def detect_lmu() -> bool:
    """
    Detect if Le Mans Ultimate is currently running.
    
    Uses two methods:
    1. Process detection via psutil (checks for LMU executables)
    2. Shared memory connection test via pyLMUSharedMemory
    
    Returns:
        bool: True if LMU is detected, False otherwise
    """
    # Method 1: Check for LMU process
    if PSUTIL_AVAILABLE:
        try:
            lmu_processes = [
                'Le Mans Ultimate',
                'LMU.exe',
                'lmu.exe',
                'LeMansUltimate.exe'
            ]
            
            for proc in psutil.process_iter(['name']):
                try:
                    proc_name = proc.info['name']
                    # Check for exact match or substring match
                    if proc_name in lmu_processes or any(lmu in proc_name for lmu in ['lmu', 'LMU', 'Le Mans']):
                        logger.info("✅ LMU detected (process)")
                        return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception as e:
            logger.debug(f"Error checking LMU processes: {e}")
    
    # Method 2: Try shared memory connection
    try:
        # Import from lib/pyLMUSharedMemory
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib', 'pyLMUSharedMemory'))
        from pyLMUSharedMemory import LMUSharedMemory
        
        sm = LMUSharedMemory()
        # Check if gameVersion is greater than 0 (indicates valid connection)
        if hasattr(sm, 'gameVersion') and sm.gameVersion > 0:
            logger.info("✅ LMU detected (shared memory)")
            return True
    except Exception as e:
        logger.debug(f"Error checking LMU shared memory: {e}")
    
    return False


def launch_service(service_name: str) -> Optional[subprocess.Popen]:
    """
    Launch the appropriate telemetry service.
    
    Args:
        service_name: Either 'iracing' or 'lmu'
    
    Returns:
        Optional[subprocess.Popen]: The launched process or None on error
    """
    # Determine script path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    if service_name == 'iracing':
        script_path = os.path.join(script_dir, 'telemetry_service.py')
    elif service_name == 'lmu':
        script_path = os.path.join(script_dir, 'lmu_service.py')
    else:
        logger.error(f"❌ Unknown service name: {service_name}")
        return None
    
    # Check if script exists
    if not os.path.exists(script_path):
        logger.error(f"❌ Service script not found: {script_path}")
        return None
    
    try:
        # Launch service using subprocess.Popen
        proc = subprocess.Popen(
            [sys.executable, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        logger.info(f"🚀 Launched {service_name} telemetry service (PID: {proc.pid})")
        return proc
    
    except Exception as e:
        logger.error(f"❌ Failed to launch {service_name} service: {e}")
        return None


def monitor_service(proc: subprocess.Popen, service_name: str):
    """
    Monitor a running telemetry service and stream its output.
    
    Args:
        proc: The subprocess to monitor
        service_name: Name of the service (for logging)
    """
    logger.info(f"📡 Monitoring {service_name} service...")
    
    try:
        # Stream stdout line by line
        for line in proc.stdout:
            print(f"[{service_name.upper()}] {line.strip()}")
        
        # Wait for process to complete
        proc.wait()
        logger.info(f"🔌 {service_name} service ended (exit code: {proc.returncode})")
    
    except KeyboardInterrupt:
        logger.info(f"⚠️  Interrupting {service_name} service...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning(f"⚠️  Force killing {service_name} service...")
            proc.kill()
            proc.wait()
        raise
    
    except Exception as e:
        logger.error(f"❌ Error monitoring {service_name} service: {e}")
        proc.terminate()
        proc.wait()


def main():
    """
    Main auto-detector loop.
    
    Continuously monitors for active simulators and launches the appropriate
    telemetry service when detected. Handles service monitoring, restarts,
    and graceful shutdown.
    """
    # Print header banner
    print("=" * 60)
    print(" " * 15 + "Telemetry Auto-Detector")
    print("=" * 60)
    print()
    logger.info("🔍 Starting automatic simulator detection...")
    
    if not PSUTIL_AVAILABLE:
        logger.warning("⚠️  Running without psutil - install it for better detection:")
        logger.warning("    pip install psutil")
        print()
    
    # Initialize state
    current_service = None
    current_process = None
    
    try:
        # Main detection loop
        while True:
            # If no service is currently running
            if current_process is None:
                logger.debug("Scanning for active simulators...")
                
                # Detect both simulators
                iracing_detected = detect_iracing()
                lmu_detected = detect_lmu()
                
                # Determine which service to launch
                if iracing_detected and lmu_detected:
                    logger.warning("⚠️  Both iRacing and LMU detected - prioritizing iRacing")
                    current_service = 'iracing'
                elif iracing_detected:
                    current_service = 'iracing'
                elif lmu_detected:
                    current_service = 'lmu'
                else:
                    current_service = None
                
                # Launch selected service
                if current_service:
                    logger.info(f"🎮 Simulator detected: {current_service.upper()}")
                    current_process = launch_service(current_service)
                    
                    if current_process:
                        # Monitor service (blocking until it ends)
                        monitor_service(current_process, current_service)
                        
                        # Service ended - reset state and wait before reconnecting
                        current_process = None
                        current_service = None
                        logger.info(f"⏳ Waiting {RECONNECT_DELAY}s before reconnecting...")
                        time.sleep(RECONNECT_DELAY)
                    else:
                        # Failed to launch - reset and retry
                        current_service = None
                        time.sleep(DETECTION_INTERVAL)
                else:
                    # No simulator detected - wait and retry
                    time.sleep(DETECTION_INTERVAL)
            
            else:
                # Service is running - just wait
                time.sleep(DETECTION_INTERVAL)
    
    except KeyboardInterrupt:
        print()
        logger.info("🛑 Shutting down auto-detector...")
        
        # Terminate current process if running
        if current_process:
            logger.info(f"Terminating {current_service} service...")
            current_process.terminate()
            try:
                current_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Force killing service...")
                current_process.kill()
                current_process.wait()
        
        logger.info("✅ Auto-detector stopped")
        sys.exit(0)
    
    except Exception as e:
        logger.error(f"❌ Fatal error in auto-detector: {e}", exc_info=True)
        
        # Cleanup
        if current_process:
            current_process.terminate()
            current_process.wait()
        
        sys.exit(1)


# Main entry point
if __name__ == "__main__":
    main()
