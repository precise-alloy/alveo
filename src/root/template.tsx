import RequireJs from '@helpers/RequireJs';
import ReactSection from '@helpers/ReactSection';

export default function Template(model: RootModel) {
  return (
    <main className="alveo-t-root">
      {model && <ReactSection css={'root'} data={model} type="root" />}

      <div className="alveo-t-root__target-wrapper" id="root-iframe-wrapper">
        <div className="alveo-t-root__target-container">
          <iframe
            className="alveo-t-root__target"
            id="root-iframe"
            name="inner"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-popups-to-escape-sandbox allow-presentation allow-top-navigation"
            title="Pages"
          />
          <div className="alveo-t-root__target-backdrop" id="root-iframe-backdrop" />
        </div>
        <div className="alveo-t-root__target-resizer" id="root-iframe-resizer" />
        <RequireJs defer path="root" />
      </div>
    </main>
  );
}
