#!python3
import os
import sys
import json
import time
import hashlib

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'pyirsdk_Reference')))

import irsdk

class State:
    last_car_setup_tick = -1
    last_setup_hash = None
    last_emit_time = 0
    was_on_pit_road = False
    was_in_pit_stall = False
    was_in_garage = False
    initial_setup_sent = False

def get_setup_hash(car_setup):
    """Genera un hash del setup para detectar cambios"""
    if not car_setup:
        return None
    try:
        setup_str = json.dumps(car_setup, sort_keys=True)
        return hashlib.md5(setup_str.encode()).hexdigest()
    except:
        return None

def emit_setup(car_setup, pit_info):
    output = {
        'type': 'IRACING_SETUP',
        'timestamp': int(time.time() * 1000),
        'carSetup': car_setup,
        'updateCount': car_setup.get('UpdateCount', 0),
        'pit': pit_info
    }
    print(json.dumps(output), flush=True)
    State.last_emit_time = time.time()

def run_daemon():
    ir = irsdk.IRSDK()
    last_connection_log = 0
    
    while True:
        if not ir.startup():
            now = time.time()
            if now - last_connection_log > 10:
                print(json.dumps({'type': 'LOG', 'message': 'Waiting for iRacing...'}), file=sys.stderr, flush=True)
                last_connection_log = now
            time.sleep(2)
            continue
        
        if ir.is_initialized and ir.is_connected:
            # Intentar obtener el tick de actualización del setup (puede fallar)
            car_setup_tick = None
            try:
                car_setup_tick = ir.get_session_info_update_by_key('CarSetup')
            except (KeyError, TypeError):
                # Si falla, usaremos el SessionNum como indicador de cambio
                session_num = ir['SessionNum']
                if session_num is not None:
                    car_setup_tick = session_num
            
            # Emit setup inicial al conectarse por primera vez
            if not State.initial_setup_sent:
                car_setup = ir['CarSetup']
                if car_setup:
                    on_pit_road = ir['OnPitRoad'] if 'OnPitRoad' in dir(ir) else False
                    in_pit_stall = ir['PlayerCarInPitStall'] if 'PlayerCarInPitStall' in dir(ir) else False
                    in_garage = ir['IsInGarage'] if 'IsInGarage' in dir(ir) else False
                    
                    emit_setup(car_setup, {
                        'onPitRoad': bool(on_pit_road),
                        'inPitStall': bool(in_pit_stall),
                        'inGarage': bool(in_garage)
                    })
                    State.initial_setup_sent = True
                    if car_setup_tick is not None:
                        State.last_car_setup_tick = car_setup_tick
                    State.last_setup_hash = get_setup_hash(car_setup)
                    print(json.dumps({'type': 'LOG', 'message': 'Initial setup sent'}), file=sys.stderr, flush=True)
            
            # Detectar cambios en el setup (por tick o por hash)
            car_setup = ir['CarSetup']
            current_hash = get_setup_hash(car_setup)
            
            tick_changed = (car_setup_tick is not None and 
                          car_setup_tick != State.last_car_setup_tick and 
                          car_setup_tick >= 0)
            hash_changed = (current_hash is not None and 
                          current_hash != State.last_setup_hash)
            
            if (tick_changed or hash_changed) and car_setup:
                on_pit_road = ir['OnPitRoad'] if 'OnPitRoad' in dir(ir) else False
                in_pit_stall = ir['PlayerCarInPitStall'] if 'PlayerCarInPitStall' in dir(ir) else False
                in_garage = ir['IsInGarage'] if 'IsInGarage' in dir(ir) else False
                
                # Emitir solo si ha pasado al menos 1 segundo desde la última emisión
                # (para evitar spam durante ajustes rápidos)
                if (time.time() - State.last_emit_time) > 1:
                    emit_setup(car_setup, {
                        'onPitRoad': bool(on_pit_road),
                        'inPitStall': bool(in_pit_stall),
                        'inGarage': bool(in_garage)
                    })
                    State.last_car_setup_tick = car_setup_tick
                    State.last_setup_hash = current_hash
                    print(json.dumps({'type': 'LOG', 'message': f'Setup changed (tick: {tick_changed}, hash: {hash_changed})'}), file=sys.stderr, flush=True)
            
            else:
                on_pit_road = ir['OnPitRoad'] if 'OnPitRoad' in dir(ir) else False
                in_pit_stall = ir['PlayerCarInPitStall'] if 'PlayerCarInPitStall' in dir(ir) else False
                in_garage = ir['IsInGarage'] if 'IsInGarage' in dir(ir) else False
                
                pit_transition = (
                    (on_pit_road and not State.was_on_pit_road) or
                    (in_pit_stall and not State.was_in_pit_stall) or
                    (in_garage and not State.was_in_garage)
                )
                
                if pit_transition and (time.time() - State.last_emit_time) > 5:
                    car_setup = ir['CarSetup']
                    if car_setup:
                        emit_setup(car_setup, {
                            'onPitRoad': bool(on_pit_road),
                            'inPitStall': bool(in_pit_stall),
                            'inGarage': bool(in_garage)
                        })
                
                State.was_on_pit_road = on_pit_road
                State.was_in_pit_stall = in_pit_stall
                State.was_in_garage = in_garage
        
        time.sleep(1)

if __name__ == '__main__':
    try:
        run_daemon()
    except KeyboardInterrupt:
        print(json.dumps({'type': 'LOG', 'message': 'Stopped by user'}), file=sys.stderr, flush=True)