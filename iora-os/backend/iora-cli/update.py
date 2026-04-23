import sys
p = 'Cargo.toml'
with open(p, 'r') as f:
    s = f.read()
with open(p, 'w') as f:
    f.write(s.replace('features = [\
