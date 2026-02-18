
import tkinter as tk
from tkinter import ttk
import threading
import time
import irsdk

FIELDS_PER_TAB = 25

class IRacingTelemetryApp:
    def __init__(self, root):
        self.root = root
        self.root.title("iRacing Telemetría en Tiempo Real (pyirsdk)")
        # Buscador
        search_frame = ttk.Frame(root)
        search_frame.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(search_frame, text="Buscar campo:").pack(side=tk.LEFT)
        self.search_var = tk.StringVar()
        self.search_var.trace_add('write', self.on_search)
        search_entry = ttk.Entry(search_frame, textvariable=self.search_var, width=30)
        search_entry.pack(side=tk.LEFT, padx=5)
        self.tabs = ttk.Notebook(root)
        self.tabs.pack(fill=tk.BOTH, expand=True)
        self.labels = []
        self.tab_frames = []
        self.current_fields = []
        self.sessioninfo_frame = None
        self.sessioninfo_table = None
        self.sessioninfo_general = None
        self.driverinfo_text = None
        self.sessioninfo_tree = None
        self.ir = irsdk.IRSDK()
        self.ir.startup()
        self.running = True
        self.last_packet = {}
        self.last_sessioninfo = {}
        threading.Thread(target=self.read_telemetry, daemon=True).start()
        self.update_ui()

    def on_search(self, *args):
        self.current_fields = None

    def read_telemetry(self):
        while self.running:
            if self.ir.is_initialized and self.ir.is_connected:
                vars_dict = {}
                try:
                    for varname in self.ir.var_headers_names:
                        try:
                            value = self.ir[varname]
                        except Exception:
                            value = "-"
                        vars_dict[varname] = value
                except Exception:
                    pass
                self.last_packet = vars_dict
                # Recoger SessionInfo completo
                try:
                    sessioninfo = self.ir['SessionInfo']
                    self.last_sessioninfo = sessioninfo if sessioninfo else {}
                except Exception:
                    self.last_sessioninfo = {}
            time.sleep(0.1)

    def _build_tabs(self, fields):
        for frame in getattr(self, 'tab_frames', []):
            frame.destroy()
        self.labels.clear()
        self.tab_frames.clear()
        for idx, field_group in enumerate(self.chunk_fields(fields, FIELDS_PER_TAB)):
            frame = ttk.Frame(self.tabs)
            self.tabs.add(frame, text=f"Campos {idx*FIELDS_PER_TAB+1}-{min((idx+1)*FIELDS_PER_TAB, len(fields))}")
            labels = {}
            for i, field in enumerate(field_group):
                ttk.Label(frame, text=field+":").grid(row=i, column=0, sticky=tk.W)
                val = ttk.Label(frame, text="-")
                val.grid(row=i, column=1, sticky=tk.W)
                labels[field] = val
            self.labels.append(labels)
            self.tab_frames.append(frame)

    def chunk_fields(self, fields, n):
        for i in range(0, len(fields), n):
            yield fields[i:i + n]

    def update_ui(self):
        packet = getattr(self, 'last_packet', {})
        all_fields = sorted(packet.keys())
        search = self.search_var.get().strip().lower() if hasattr(self, 'search_var') else ''
        if search:
            fields = [f for f in all_fields if search in f.lower()]
        else:
            fields = all_fields
        # Reconstruir pestañas si los campos han cambiado
        if fields != self.current_fields:
            self.current_fields = fields
            for i in reversed(range(self.tabs.index('end'))):
                self.tabs.forget(i)
            self._build_tabs(fields)
            # Añadir pestaña SessionInfo si no existe
            if self.sessioninfo_frame is None:
                frame = ttk.Frame(self.tabs)
                self.sessioninfo_frame = frame
                # Datos generales de la sesión
                self.sessioninfo_general = tk.Text(frame, wrap=tk.NONE, height=8, width=120, bg='#f8f8f8', fg='#222222')
                self.sessioninfo_general.pack(fill=tk.X, expand=False)
                # DriverInfo debug
                self.driverinfo_text = tk.Text(frame, wrap=tk.NONE, height=8, width=120, bg='#e8f8ff', fg='#222222')
                self.driverinfo_text.pack(fill=tk.X, expand=False)
                # Tabla de rivales con Treeview
                tree_frame = ttk.Frame(frame)
                tree_frame.pack(fill=tk.BOTH, expand=True)
                self.sessioninfo_tree = ttk.Treeview(tree_frame, show='headings')
                self.sessioninfo_tree.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)
                # Scrollbar
                scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.sessioninfo_tree.yview)
                self.sessioninfo_tree.configure(yscrollcommand=scrollbar.set)
                scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
                self.tabs.add(frame, text="SessionInfo (Contexto)")
        # Actualizar valores de telemetría
        for tab_labels in self.labels:
            for field, label in tab_labels.items():
                value = packet.get(field, '-')
                label.config(text=str(value))
        # Actualizar SessionInfo
        if self.sessioninfo_frame is not None:
            # Limpiar texto general y DriverInfo
            self.sessioninfo_general.delete(1.0, tk.END)
            self.driverinfo_text.delete(1.0, tk.END)
            sessioninfo = self.last_sessioninfo
            if sessioninfo:
                sessions = sessioninfo.get('Sessions', [])
                current_session_num = sessioninfo.get('CurrentSessionNum', 0)
                session_data = sessions[current_session_num] if sessions and current_session_num < len(sessions) else {}
                general_fields = [
                    ('SessionName', 'Nombre'),
                    ('SessionType', 'Tipo'),
                    ('SessionSubType', 'Subtipo'),
                    ('SessionTime', 'Duración'),
                    ('SessionLaps', 'Vueltas'),
                    ('SessionTrackRubberState', 'Estado pista'),
                    ('ResultsNumLeadChanges', 'Cambios líder'),
                    ('ResultsNumCautionFlags', 'Banderas amarillas'),
                    ('ResultsNumCautionLaps', 'Vueltas amarillas'),
                ]
                for key, label in general_fields:
                    val = session_data.get(key, '-')
                    self.sessioninfo_general.insert(tk.END, f"{label}: {val}\n")
                self.sessioninfo_general.insert(tk.END, "\n")
                # Mostrar DriverInfo completo para depuración (acceso correcto)
                import pprint
                driver_info = self.ir['DriverInfo'] if hasattr(self, 'ir') else {}
                self.driverinfo_text.insert(tk.END, "ir['DriverInfo'] (estructura completa):\n")
                self.driverinfo_text.insert(tk.END, pprint.pformat(driver_info, indent=2, width=120))
                self.driverinfo_text.insert(tk.END, "\n")
                # Mostrar tabla de rivales con Treeview
                positions = session_data.get('ResultsPositions', [])
                all_keys = set()
                for pos in positions:
                    all_keys.update(pos.keys())
                headers = ['Position', 'CarIdx', 'CarNumber', 'UserName'] + sorted(all_keys - {'Position', 'CarIdx'})
                # Configurar columnas solo si cambian
                if not hasattr(self, 'sessioninfo_tree_headers') or getattr(self, 'sessioninfo_tree_headers', None) != headers:
                    self.sessioninfo_tree_headers = headers
                    self.sessioninfo_tree['columns'] = headers
                    for h in headers:
                        self.sessioninfo_tree.heading(h, text=h)
                        self.sessioninfo_tree.column(h, width=80, anchor=tk.CENTER)
                # Limpiar y actualizar filas
                self.sessioninfo_tree.delete(*self.sessioninfo_tree.get_children())
                driver_info = self.ir['DriverInfo'] if hasattr(self, 'ir') else {}
                drivers = driver_info.get('Drivers', []) if driver_info else []
                caridx_to_name = {d.get('CarIdx'): d.get('UserName', '') for d in drivers}
                caridx_to_number = {d.get('CarIdx'): d.get('CarNumber', '') for d in drivers}
                for pos in positions:
                    vals = []
                    for h in headers:
                        if h == 'UserName':
                            v = caridx_to_name.get(pos.get('CarIdx'), '-')
                        elif h == 'CarNumber':
                            v = caridx_to_number.get(pos.get('CarIdx'), '-')
                        else:
                            v = pos.get(h, '-')
                            if isinstance(v, float):
                                v = f"{v:.3f}"
                        vals.append(v)
                    self.sessioninfo_tree.insert('', 'end', values=vals)
        self.root.after(100, self.update_ui)

    def on_close(self):
        self.running = False
        self.ir.shutdown()
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = IRacingTelemetryApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_close)
    root.mainloop()
